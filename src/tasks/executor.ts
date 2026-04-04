// Task executor
import { TaskMode } from './types';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';
import type { Message } from '../conversation/manager';
import { MemorySelector } from '../memory/selector';
import { MemoryManager } from '../memory/manager';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eventBridge } from '../channels/bridge/event-bridge';

export interface ExecuteRequest {
  mode: TaskMode;
  instruction: string;
  workspace: string;
  apiKey: string;
  conversationHistory?: Message[];
}

export interface ExecuteResult {
  output: string;
  files?: string[];
  error?: string;
}

interface ModelConfig {
  provider: string;
  apiKey: string;
  modelName: string;
  apiEndpoint?: string;
  apiProtocol?: string;
  temperature?: number;
  maxTokens?: number;
}

export class TaskExecutor {
  private memorySelector: MemorySelector;

  constructor(
    private skillLoader: SkillLoader,
    private toolRegistry: ToolRegistry
  ) {
    const memoryManager = new MemoryManager();
    memoryManager.init().catch(err => {
      console.error('Failed to initialize memory manager:', err);
    });

    this.memorySelector = new MemorySelector(memoryManager);
    this.memorySelector.init().catch(err => {
      console.error('Failed to initialize memory selector:', err);
    });
  }

  private async loadModelConfig(): Promise<ModelConfig | null> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configPath = join(homedir(), '.jobopx', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.model || null;
    } catch (error) {
      return null;
    }
  }

  private async buildMessages(instruction: string, history?: Message[]) {
    // 加载记忆并注入到 system prompt
    let systemContent = '你是一个专业的 AI 助手，帮助用户完成各种任务。你能记住之前的对话内容。';

    try {
      const memoryResult = await this.memorySelector.select(instruction);
      if (memoryResult.memories.length > 0) {
        const memoryContent = this.memorySelector.formatForPrompt(memoryResult);
        systemContent += '\n\n# Long-term Memory\n\n' + memoryContent;
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
      // Continue without memories
    }

    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: systemContent
      }
    ];

    // 添加历史消息（最多保留最近10轮对话）
    if (history && history.length > 0) {
      const recentHistory = history.slice(-20); // 最多20条消息（10轮对话）
      for (const msg of recentHistory) {
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    // 添加当前指令
    messages.push({
      role: 'user',
      content: instruction
    });

    return messages;
  }

  private async callOpenAIAPI(config: ModelConfig, instruction: string, history?: Message[]): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1';
    const messages = await this.buildMessages(instruction, history);

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.modelName || 'gpt-4-turbo',
        messages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 调用失败: ${response.status} ${error}`);
    }

    const result = await response.json();
    return result.choices[0].message.content;
  }

  private async callOpenAIAPIStream(config: ModelConfig, instruction: string, history: Message[] | undefined, onChunk: (chunk: string) => void): Promise<void> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1';
    const messages = await this.buildMessages(instruction, history);

    // 获取所有注册的 tools
    const tools = this.toolRegistry.getAll();
    console.log(`[Executor] 注册的工具数量: ${tools.length}`);
    console.log(`[Executor] 工具列表:`, tools.map(t => t.name).join(', '));

    const toolsParam = tools.length > 0 ? tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
      }
    })) : undefined;

    console.log(`[Executor] 发送给 API 的工具参数:`, JSON.stringify(toolsParam, null, 2));

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.modelName || 'gpt-4-turbo',
        messages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
        tools: toolsParam,
        stream: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 调用失败: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls: any[] = [];
    let currentToolCall: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta;

            // 处理文本内容
            if (delta?.content) {
              onChunk(delta.content);
            }

            // 处理 tool_calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.index !== undefined) {
                  if (!toolCalls[toolCall.index]) {
                    toolCalls[toolCall.index] = {
                      id: toolCall.id || '',
                      type: 'function',
                      function: {
                        name: toolCall.function?.name || '',
                        arguments: ''
                      }
                    };
                  }

                  if (toolCall.function?.arguments) {
                    toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                  }
                }
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    // 执行 tool calls
    if (toolCalls.length > 0) {
      console.log(`[Executor] 检测到 ${toolCalls.length} 个工具调用`);
      onChunk('\n\n[执行工具调用...]\n');

      for (const toolCall of toolCalls) {
        const tool = this.toolRegistry.get(toolCall.function.name);
        if (!tool) {
          onChunk(`\n❌ 工具 ${toolCall.function.name} 未找到\n`);
          continue;
        }

        try {
          // 调试：输出原始参数
          console.log('Tool call arguments:', toolCall.function.arguments);

          const args = JSON.parse(toolCall.function.arguments);
          console.log('Parsed args:', args);

          onChunk(`\n🔧 调用工具: ${toolCall.function.name}\n`);

          const result = await tool.call(args, {
            workDir: process.cwd(),
            taskId: Date.now().toString(),
            mode: 'ask'
          });

          // 处理工具结果 - 应用映射和持久化
          const { processToolResultBlock } = await import('../tools/tool-result-storage');
          const sessionId = Date.now().toString(); // 使用 taskId 作为 sessionId
          const toolUseId = toolCall.id || `tool_${Date.now()}`;

          const processedResult = await processToolResultBlock(
            tool,
            result.data,
            toolUseId,
            sessionId
          );

          if (result.error) {
            onChunk(`\n❌ 工具执行失败: ${result.error}\n`);
          } else {
            // 显示处理后的结果
            const content = typeof processedResult.content === 'string'
              ? processedResult.content
              : JSON.stringify(processedResult.content);
            onChunk(`\n✅ 工具执行成功: ${content}\n`);
          }
        } catch (error: any) {
          console.error('Tool execution error:', error);
          onChunk(`\n❌ 工具执行错误: ${error.message}\n参数: ${toolCall.function.arguments}\n`);
        }
      }

      console.log(`[Executor] 所有工具调用执行完成，工具数量: ${toolCalls.length}`);
      onChunk('\n\n[工具调用完成]\n');
    } else {
      console.log(`[Executor] 没有检测到工具调用`);
    }
  }

  private async callAnthropicAPI(config: ModelConfig, instruction: string, history?: Message[]): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.anthropic.com/v1';

    // Anthropic API 不支持 system role 在 messages 中，需要单独传递
    const messages: Array<{ role: string; content: string }> = [];

    // 添加历史消息
    if (history && history.length > 0) {
      const recentHistory = history.slice(-20);
      for (const msg of recentHistory) {
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    // 添加当前指令
    messages.push({
      role: 'user',
      content: instruction
    });

    // 获取所有注册的 tools
    const tools = this.toolRegistry.getAll();
    const toolsParam = tools.length > 0 ? tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
    })) : undefined;

    const response = await fetch(`${endpoint}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.modelName || 'claude-3-5-sonnet-20241022',
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
        system: '你是一个专业的 AI 助手，帮助用户完成各种任务。你能记住之前的对话内容。',
        messages,
        tools: toolsParam
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 调用失败: ${response.status} ${error}`);
    }

    const result = await response.json();

    // 处理工具调用
    if (result.stop_reason === 'tool_use') {
      let responseText = '';

      for (const content of result.content) {
        if (content.type === 'text') {
          responseText += content.text;
        } else if (content.type === 'tool_use') {
          const tool = this.toolRegistry.get(content.name);
          if (tool) {
            try {
              responseText += `\n\n[执行工具: ${content.name}]\n`;

              const toolResult = await tool.call(content.input, {
                workDir: process.cwd(),
                taskId: Date.now().toString(),
                mode: 'ask'
              });

              // 处理工具结果
              const { processToolResultBlock } = await import('../tools/tool-result-storage');
              const sessionId = Date.now().toString();
              const toolUseId = content.id || `tool_${Date.now()}`;

              const processedResult = await processToolResultBlock(
                tool,
                toolResult.data,
                toolUseId,
                sessionId
              );

              const resultContent = typeof processedResult.content === 'string'
                ? processedResult.content
                : JSON.stringify(processedResult.content);

              responseText += `✅ ${resultContent}\n`;
            } catch (error: any) {
              responseText += `❌ 工具执行错误: ${error.message}\n`;
            }
          } else {
            responseText += `\n❌ 工具 ${content.name} 未找到\n`;
          }
        }
      }

      return responseText;
    }

    return result.content[0].text;
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    try {
      // 加载模型配置
      const config = await this.loadModelConfig();

      if (!config || !config.apiKey) {
        const error = '请先在设置页面配置 API Key';
        eventBridge.notifyTaskComplete(taskId, {
          taskName: request.instruction.substring(0, 50),
          error,
          duration: Date.now() - startTime,
          status: 'failed',
        });
        return {
          output: '',
          error
        };
      }

      // 根据提供商和协议类型调用相应的 API
      let response: string;

      if (config.provider === 'openai') {
        response = await this.callOpenAIAPI(config, request.instruction, request.conversationHistory);
      } else if (config.provider === 'anthropic') {
        response = await this.callAnthropicAPI(config, request.instruction, request.conversationHistory);
      } else if (config.provider === 'custom') {
        // 自定义端点，根据协议类型选择
        if (config.apiProtocol === 'anthropic') {
          response = await this.callAnthropicAPI(config, request.instruction, request.conversationHistory);
        } else {
          // 默认使用 OpenAI 协议
          response = await this.callOpenAIAPI(config, request.instruction, request.conversationHistory);
        }
      } else {
        const error = '未知的 API 提供商';
        eventBridge.notifyTaskComplete(taskId, {
          taskName: request.instruction.substring(0, 50),
          error,
          duration: Date.now() - startTime,
          status: 'failed',
        });
        return {
          output: '',
          error
        };
      }

      // 发送任务完成事件
      eventBridge.notifyTaskComplete(taskId, {
        taskName: request.instruction.substring(0, 50),
        result: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
        duration: Date.now() - startTime,
        status: 'success',
      });

      return {
        output: response,
        files: []
      };
    } catch (error: any) {
      // 发送任务失败事件
      eventBridge.notifyTaskComplete(taskId, {
        taskName: request.instruction.substring(0, 50),
        error: error.message,
        duration: Date.now() - startTime,
        status: 'failed',
      });

      return {
        output: '',
        error: error.message
      };
    }
  }

  async executeStream(request: ExecuteRequest, onChunk: (chunk: string) => void): Promise<void> {
    try {
      // 加载模型配置
      const config = await this.loadModelConfig();

      if (!config || !config.apiKey) {
        throw new Error('请先在设置页面配置 API Key');
      }

      // 根据提供商和协议类型调用相应的 API
      if (config.provider === 'openai') {
        await this.callOpenAIAPIStream(config, request.instruction, request.conversationHistory, onChunk);
      } else if (config.provider === 'anthropic') {
        // Anthropic 使用非流式但支持工具调用
        const response = await this.callAnthropicAPI(config, request.instruction, request.conversationHistory);
        onChunk(response);
      } else if (config.provider === 'custom') {
        // 自定义端点，根据协议类型选择
        if (config.apiProtocol === 'anthropic') {
          const response = await this.callAnthropicAPI(config, request.instruction, request.conversationHistory);
          onChunk(response);
        } else {
          // 默认使用 OpenAI 协议
          await this.callOpenAIAPIStream(config, request.instruction, request.conversationHistory, onChunk);
        }
      } else {
        throw new Error('未知的 API 提供商');
      }
    } catch (error: any) {
      throw error;
    }
  }
}
