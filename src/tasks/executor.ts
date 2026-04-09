// Task executor
import { randomUUID } from 'node:crypto';
import { type ImageAttachment, TaskMode } from './types';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';
import type { Message } from '../conversation/manager';
import { MemorySelector } from '../memory/selector';
import { MemoryManager } from '../memory/manager';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eventBridge } from '../channels/bridge/event-bridge';
import { appendAgentLog, truncateText } from '../utils/agent-execution-log';
import {
  checkPlanModeToolInvocation,
  getParallelToolBatchSystemSection,
  getPlanModeSystemAppendix,
  getToolsForTaskMode,
} from './plan-mode-policy';
import {
  executePartitionedBatches,
  partitionToolCalls,
  refineBatchesForDisjointWritePaths,
  type ToolCallPartitionItem,
  type ToolExecutionBatch,
} from './tool-call-partition';

/** 从工具 raw JSON 参数中提取 file_path，便于并发场景下对照日志与 tool_call 顺序 */
function filePathFromRawToolArgs(raw: string): string | undefined {
  try {
    const j = JSON.parse(raw && raw.trim() ? raw : '{}') as Record<string, unknown>;
    const fp = j.file_path;
    return typeof fp === 'string' ? fp : undefined;
  } catch {
    return undefined;
  }
}

/** 执行请求：模型 API Key 等凭证仅由 TaskExecutor 从 ~/.squid/config.json 读取，不由 Channel 传入 */
export interface ExecuteRequest {
  mode: TaskMode;
  instruction: string;
  workspace: string;
  conversationHistory?: Message[];
  attachments?: ImageAttachment[];
  /** 用于 Plan 模式计划文件路径：`.squid/plan-<id>.md` */
  conversationId?: string;
  /** 任务级取消信号（Esc/主动中断） */
  abortSignal?: AbortSignal;
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

function buildOpenAIUserContent(instruction: string, attachments: ImageAttachment[]): string | Array<Record<string, unknown>> {
  if (!attachments.length) return instruction;
  const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: instruction }];
  for (const item of attachments) {
    blocks.push({
      type: 'image_url',
      image_url: {
        url: item.dataUrl,
      },
    });
  }
  return blocks;
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

  /** 按各工具 isConcurrencySafe + 写路径批内规则得到执行批次 */
  private buildToolExecutionBatches(
    metas: ToolCallPartitionItem[],
    workspace: string
  ): ToolExecutionBatch[] {
    const batches = partitionToolCalls(this.toolRegistry, metas);
    refineBatchesForDisjointWritePaths(batches, workspace);
    return batches;
  }

  private async loadModelConfig(): Promise<ModelConfig | null> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configPath = join(homedir(), '.squid', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.model || null;
    } catch (error) {
      return null;
    }
  }

  private async executeToolAndFormatResult(params: {
    toolName: string;
    rawArguments: string;
    workspace: string;
    mode: TaskMode;
    conversationId?: string;
    abortSignal?: AbortSignal;
  }): Promise<{ content: string; isError: boolean }> {
    const tool = this.toolRegistry.get(params.toolName);
    if (!tool) {
      return {
        content: `工具 ${params.toolName} 未找到`,
        isError: true,
      };
    }

    let args: any = {};
    try {
      args = params.rawArguments ? JSON.parse(params.rawArguments) : {};
    } catch (error: any) {
      return {
        content: `工具参数解析失败: ${error.message}`,
        isError: true,
      };
    }

    if (params.mode === 'plan') {
      const planCheck = checkPlanModeToolInvocation(
        params.toolName,
        args,
        params.workspace,
        params.conversationId
      );
      if (!planCheck.ok) {
        return {
          content: planCheck.message,
          isError: true,
        };
      }
    }

    try {
      const result = await tool.call(args, {
        workDir: params.workspace || process.cwd(),
        taskId: randomUUID(),
        mode: params.mode,
        abortSignal: params.abortSignal,
      });

      if (result.error) {
        return {
          content: result.error,
          isError: true,
        };
      }

      const { processToolResultBlock } = await import('../tools/tool-result-storage');
      const toolUseId = `tool_${randomUUID()}`;
      const sessionId = randomUUID();
      const processedResult = await processToolResultBlock(
        tool,
        result.data,
        toolUseId,
        sessionId
      );
      const content = typeof processedResult.content === 'string'
        ? processedResult.content
        : JSON.stringify(processedResult.content);

      return {
        content: content || '',
        isError: false,
      };
    } catch (error: any) {
      return {
        content: `工具执行错误: ${error.message}`,
        isError: true,
      };
    }
  }

  private async buildMessages(
    instruction: string,
    workspace: string,
    history: Message[] | undefined,
    mode: TaskMode,
    attachments: ImageAttachment[] = [],
    conversationId?: string
  ) {
    // 加载记忆并注入到 system prompt
    let systemContent = '你是一个专业的 AI 助手，帮助用户完成各种任务。你能记住之前的对话内容。';
    systemContent += `\n\n# Workspace\n当前工作目录（必须遵守）: ${workspace}\n` +
      '所有需要文件系统/命令行的操作，都必须以该目录作为工作目录。\n' +
      'read_file / write_file / file_edit 的 file_path 须为相对该目录的路径（例如 hello.all、src/a.ts）；禁止把绝对路径里的 / 换成点号写成 .Users.xxx.xxx 等形式。\n' +
      '同轮多个 agent 时：若各子任务都会写入同一文件，不要并发多个 agent（会覆盖），应分轮或让主会话汇总后一次 write_file。\n' +
      '当执行 git clone 且用户没有指定目标目录时，必须显式指定目标路径到该工作目录下（例如：git clone <repo> "<工作目录>/<仓库名>"）。';

    systemContent += getParallelToolBatchSystemSection();

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

    // 仅当本执行器注册了 skill 工具时，才注入技能列表，避免子执行器误导模型触发递归。
    if (this.toolRegistry.get('skill')) {
      try {
        const summaries = await this.skillLoader.listSkillSummaries();
        const invocableSkills = summaries
          .filter((skill) => skill.userInvocable)
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .sort();

        if (invocableSkills.length > 0) {
          systemContent += '\n\n# Available Skills\n';
          systemContent += '以下是当前可调用的已安装技能（与技能中心一致）：\n';
          systemContent += invocableSkills.join('\n');
          systemContent +=
            '\n\n当用户要求列出/展示「当前有哪些技能」「你有哪些技能」「可用技能」等时：必须使用 `skill` 工具且 `skill_name` 为 `list-skills`，直接返回上表中的本地技能；' +
            '不要调用 `find-skills-in-tencent-skillhub` 或其它 SkillHub/skillhub CLI 技能来完成此需求（那些仅用于搜索/安装远程市场技能，且依赖本机安装 skillhub、jq）。';
        } else {
          systemContent += '\n\n# Available Skills\n当前没有可调用的已安装技能。';
        }
      } catch (error) {
        console.error('Failed to load skills for prompt context:', error);
      }
    }

    if (mode === 'plan') {
      systemContent += getPlanModeSystemAppendix(workspace, conversationId);
    }

    const messages: Array<{ role: string; content: unknown }> = [
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

    messages.push({
      role: 'user',
      content: buildOpenAIUserContent(instruction, attachments),
    });

    return messages;
  }

  private async callOpenAIAPI(
    config: ModelConfig,
    instruction: string,
    workspace: string,
    history: Message[] | undefined,
    mode: TaskMode,
    attachments: ImageAttachment[] = [],
    conversationId?: string
  ): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1';
    const messages: Array<Record<string, any>> = await this.buildMessages(
      instruction,
      workspace,
      history,
      mode,
      attachments,
      conversationId
    );

    const tools = getToolsForTaskMode(mode, this.toolRegistry);
    const toolsParam = tools.length > 0 ? tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
      }
    })) : undefined;

    const maxToolRounds = 20;
    let finalText = '';

    for (let round = 0; round < maxToolRounds; round++) {
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
          tools: toolsParam
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API 调用失败: ${response.status} ${error}`);
      }

      const result = await response.json();
      const message = result.choices?.[0]?.message || {};
      const assistantContent = typeof message.content === 'string' ? message.content : '';
      const assistantReasoning =
        typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
      if (assistantContent) {
        finalText += assistantContent;
      }

      const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: rawToolCalls.length > 0 ? rawToolCalls : undefined
      };
      if (rawToolCalls.length > 0) {
        assistantMsg.reasoning_content = assistantReasoning;
      }
      messages.push(assistantMsg);

      if (rawToolCalls.length === 0) {
        return finalText || '';
      }

      const toolMetas = rawToolCalls.map((toolCall: Record<string, unknown>) => ({
        toolName: (toolCall?.function as { name?: string } | undefined)?.name || '',
        rawArguments: (toolCall?.function as { arguments?: string } | undefined)?.arguments || '',
        toolCallId:
          (toolCall?.id as string | undefined) ||
          `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }));

      const batches = this.buildToolExecutionBatches(toolMetas, workspace);

      const runOne = async (m: ToolCallPartitionItem) => {
        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace,
          mode,
          conversationId,
        });
        return {
          tool_call_id: m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          content: toolResult.content,
        };
      };

      const toolOut = await executePartitionedBatches(batches, runOne);

      for (const row of toolOut) {
        messages.push({
          role: 'tool',
          tool_call_id: row.tool_call_id,
          content: row.content,
        });
      }
    }

    return `${finalText}\n\n⚠️ 工具调用轮次达到上限，已停止自动继续。`.trim();
  }

  private async callOpenAIAPIStream(
    config: ModelConfig,
    instruction: string,
    history: Message[] | undefined,
    workspace: string,
    onChunk: (chunk: string) => void,
    mode: TaskMode,
    attachments: ImageAttachment[] = [],
    conversationId?: string,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1';
    const initialMessages = await this.buildMessages(
      instruction,
      workspace,
      history,
      mode,
      attachments,
      conversationId
    );
    const messages: Array<Record<string, any>> = [...initialMessages];

    const tools = getToolsForTaskMode(mode, this.toolRegistry);
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
    const maxToolRounds = 20;
    for (let round = 0; round < maxToolRounds; round++) {
      appendAgentLog('executor', 'debug', `OpenAI 流式 第 ${round + 1} 轮请求`, {
        toolCount: tools.length,
      });
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: abortSignal,
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
        appendAgentLog('executor', 'error', 'OpenAI 流式 API 调用失败', {
          status: response.status,
          bodyPreview: truncateText(error, 300),
          round: round + 1,
        });
        throw new Error(`API 调用失败: ${response.status} ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      /** 思考链/推理内容：开启 thinking 的模型在 tool_calls 轮次要求回传 reasoning_content */
      let assistantReasoning = '';
      const toolCalls: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta;

            if (typeof delta?.reasoning_content === 'string') {
              assistantReasoning += delta.reasoning_content;
            } else if (typeof delta?.reasoning === 'string') {
              assistantReasoning += delta.reasoning;
            }

            if (typeof delta?.content === 'string') {
              assistantContent += delta.content;
              onChunk(delta.content);
            }

            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.index === undefined) continue;
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

                if (toolCall.id) {
                  toolCalls[toolCall.index].id = toolCall.id;
                }
                if (toolCall.function?.name) {
                  toolCalls[toolCall.index].function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                }
              }
            }
          } catch {
            // Skip invalid JSON chunks
          }
        }
      }

      const resolvedToolCalls = toolCalls.filter(Boolean);

      // 本轮没有工具调用，说明模型已给出最终回答
      if (resolvedToolCalls.length === 0) {
        console.log(`[Executor] 第 ${round + 1} 轮未检测到工具调用，流式回复完成`);
        appendAgentLog('executor', 'info', `OpenAI 流式 第 ${round + 1} 轮结束（无工具调用）`, {
          assistantChars: assistantContent.length,
        });
        return;
      }

      console.log(`[Executor] 第 ${round + 1} 轮检测到 ${resolvedToolCalls.length} 个工具调用`);
      appendAgentLog('executor', 'info', `OpenAI 流式 第 ${round + 1} 轮：工具调用`, {
        tools: resolvedToolCalls.map((c) => c.function?.name || '(unknown)').join(', '),
        count: resolvedToolCalls.length,
      });
      onChunk('\n\n[执行工具调用...]\n');

      // 先把 assistant tool_call 消息加入上下文，再追加每个 tool result
      messages.push({
        role: 'assistant',
        content: assistantContent || null,
        reasoning_content: assistantReasoning,
        tool_calls: resolvedToolCalls.map((toolCall) => ({
          id: toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: toolCall.function?.name || '',
            arguments: toolCall.function?.arguments || ''
          }
        }))
      });

      const streamMetas = resolvedToolCalls.map((toolCall) => ({
        toolName: toolCall.function?.name || '',
        rawArguments: toolCall.function?.arguments || '',
        toolCallId: toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }));

      const streamBatches = this.buildToolExecutionBatches(streamMetas, workspace);

      const runStreamOne = async (m: ToolCallPartitionItem) => {
        console.log('Tool call arguments:', m.rawArguments);
        const filePath = filePathFromRawToolArgs(m.rawArguments);
        appendAgentLog('executor', 'info', `工具调用: ${m.toolName}`, {
          argsPreview: truncateText(m.rawArguments, 500),
          ...(filePath ? { file_path: filePath } : {}),
        });
        onChunk(`\n🔧 调用工具: ${m.toolName}\n`);

        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace,
          mode,
          conversationId,
          abortSignal,
        });

        if (toolResult.isError) {
          appendAgentLog('executor', 'warn', `工具结果: ${m.toolName}`, {
            resultPreview: truncateText(toolResult.content, 400),
            ...(filePath ? { file_path: filePath } : {}),
          });
          onChunk(`\n❌ ${toolResult.content}\n`);
        } else {
          appendAgentLog('executor', 'debug', `工具结果: ${m.toolName}`, {
            resultPreview: truncateText(toolResult.content, 400),
            ...(filePath ? { file_path: filePath } : {}),
          });
          onChunk(`\n✅ 工具执行成功: ${toolResult.content}\n`);
        }

        return {
          tool_call_id: m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          content: toolResult.content,
        };
      };

      const streamOut = await executePartitionedBatches(streamBatches, runStreamOne);

      for (const row of streamOut) {
        messages.push({
          role: 'tool',
          tool_call_id: row.tool_call_id,
          content: row.content,
        });
      }

      console.log(`[Executor] 第 ${round + 1} 轮工具调用执行完成，继续向模型请求后续输出`);
      onChunk('\n\n[工具调用完成，继续生成...]\n');
    }

    onChunk('\n⚠️ 工具调用轮次达到上限，已停止自动继续。\n');
  }

  private async callAnthropicAPI(
    config: ModelConfig,
    instruction: string,
    workspace: string | undefined,
    history: Message[] | undefined,
    mode: TaskMode,
    conversationId?: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.anthropic.com/v1';

    // Anthropic API 不支持 system role 在 messages 中，需要单独传递
    const messages: Array<Record<string, any>> = [];

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

    messages.push({
      role: 'user',
      content: instruction,
    });

    const tools = getToolsForTaskMode(mode, this.toolRegistry);
    const toolsParam = tools.length > 0 ? tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
    })) : undefined;

    const maxToolRounds = 20;
    let finalText = '';

    let anthropicSystem = `你是一个专业的 AI 助手，帮助用户完成各种任务。你能记住之前的对话内容。
当前工作目录（必须遵守）: ${workspace || process.cwd()}
所有需要文件系统/命令行的操作，都必须在该工作目录下执行。
read_file / write_file / file_edit 的 file_path 须为相对该目录的路径（例如 hello.all）；禁止把绝对路径里的 / 换成点号写成 .Users.xxx.xxx 等形式。
同轮多个 agent 若都会写同一 file_path，不要并发（会覆盖），应分轮或由主会话一次合并写入。
当执行 git clone 且用户没有指定目标目录时，必须显式指定目标路径到该工作目录下（例如：git clone <repo> "<工作目录>/<仓库名>"）。`;
    if (mode === 'plan') {
      anthropicSystem += getPlanModeSystemAppendix(workspace || process.cwd(), conversationId);
    }

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await fetch(`${endpoint}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        signal: abortSignal,
        body: JSON.stringify({
          model: config.modelName || 'claude-3-5-sonnet-20241022',
          max_tokens: config.maxTokens || 4096,
          temperature: config.temperature || 0.7,
          system: anthropicSystem,
          messages,
          tools: toolsParam
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API 调用失败: ${response.status} ${error}`);
      }

      const result = await response.json();
      const contents = Array.isArray(result.content) ? result.content : [];
      const toolUses = contents.filter((content: any) => content.type === 'tool_use');
      const text = contents
        .filter((content: any) => content.type === 'text')
        .map((content: any) => content.text || '')
        .join('');

      if (text) {
        finalText += text;
      }

      messages.push({
        role: 'assistant',
        content: contents
      });

      if (toolUses.length === 0) {
        return finalText || '';
      }

      const anthropicMetas = toolUses.map((toolUse: { id: string; name?: string; input?: unknown }) => ({
        toolName: toolUse.name || '',
        rawArguments: JSON.stringify(toolUse.input || {}),
        toolUseId: toolUse.id,
      }));

      const ws = workspace || process.cwd();
      const anthropicBatches = this.buildToolExecutionBatches(anthropicMetas, ws);

      const runAnthropicOne = async (m: (typeof anthropicMetas)[0]) => {
        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace: ws,
          mode,
          conversationId,
          abortSignal,
        });
        return {
          type: 'tool_result' as const,
          tool_use_id: m.toolUseId,
          content: toolResult.content,
          is_error: toolResult.isError,
        };
      };

      const toolResults = await executePartitionedBatches(anthropicBatches, runAnthropicOne);

      messages.push({
        role: 'user',
        content: toolResults
      });
    }

    return `${finalText}\n\n⚠️ 工具调用轮次达到上限，已停止自动继续。`.trim();
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    try {
      // 加载模型配置
      const config = await this.loadModelConfig();

      if (!config || !config.apiKey) {
        const error = '请先在设置页面配置 API Key';
        appendAgentLog('executor', 'warn', 'execute 跳过：未配置 API Key');
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

      appendAgentLog('executor', 'info', 'TaskExecutor.execute 开始', {
        provider: config.provider,
        model: config.modelName || '',
        workspace: request.workspace,
        instructionPreview: truncateText(request.instruction, 240),
      });

      // 根据提供商和协议类型调用相应的 API
      let response: string;

      if (config.provider === 'openai') {
        response = await this.callOpenAIAPI(
          config,
          request.instruction,
          request.workspace,
          request.conversationHistory,
          request.mode,
          request.attachments || [],
          request.conversationId
        );
      } else if (config.provider === 'anthropic') {
        if ((request.attachments || []).length > 0) {
          throw new Error('当前 provider 暂不支持图片输入，请切换到 OpenAI 兼容模型。');
        }
        response = await this.callAnthropicAPI(
          config,
          request.instruction,
          request.workspace,
          request.conversationHistory,
          request.mode,
          request.conversationId,
        );
      } else if (config.provider === 'custom') {
        // 自定义端点，根据协议类型选择
        if (config.apiProtocol === 'anthropic') {
          if ((request.attachments || []).length > 0) {
            throw new Error('当前 provider 暂不支持图片输入，请切换到 OpenAI 兼容模型。');
          }
          response = await this.callAnthropicAPI(
            config,
            request.instruction,
            request.workspace,
            request.conversationHistory,
            request.mode,
            request.conversationId,
          );
        } else {
          // 默认使用 OpenAI 协议
          response = await this.callOpenAIAPI(
            config,
            request.instruction,
            request.workspace,
            request.conversationHistory,
            request.mode,
            request.attachments || [],
            request.conversationId
          );
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

      appendAgentLog('executor', 'info', 'TaskExecutor.execute 完成', {
        durationMs: Date.now() - startTime,
        responseChars: response.length,
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

      appendAgentLog('executor', 'error', 'TaskExecutor.execute 失败', {
        error: truncateText(error?.message || String(error), 500),
        durationMs: Date.now() - startTime,
      });
      return {
        output: '',
        error: error.message
      };
    }
  }

  async executeStream(request: ExecuteRequest, onChunk: (chunk: string) => void): Promise<void> {
    try {
      const fileConfig = await this.loadModelConfig();
      if (!fileConfig?.apiKey?.trim()) {
        throw new Error('请先在设置页面配置模型（~/.squid/config.json 中 model.apiKey）');
      }
      if (!fileConfig.provider?.trim()) {
        throw new Error('请先在设置页面配置模型提供商（~/.squid/config.json 中 model.provider）');
      }
      const config: ModelConfig = fileConfig as ModelConfig;

      console.log(
        '[LLM] TaskExecutor.executeStream → 调用模型 provider=%s model=%s',
        config.provider,
        config.modelName || '(默认)'
      );

      appendAgentLog('executor', 'info', 'TaskExecutor.executeStream 调用模型', {
        provider: config.provider,
        model: config.modelName || '',
        workspace: request.workspace,
        instructionPreview: truncateText(request.instruction, 240),
      });

      // 根据提供商和协议类型调用相应的 API
      if (config.provider === 'openai') {
        await this.callOpenAIAPIStream(
          config,
          request.instruction,
          request.conversationHistory,
          request.workspace,
          onChunk,
          request.mode,
          request.attachments || [],
          request.conversationId,
          request.abortSignal
        );
      } else if (config.provider === 'anthropic') {
        if ((request.attachments || []).length > 0) {
          throw new Error('当前 provider 暂不支持图片输入，请切换到 OpenAI 兼容模型。');
        }
        // Anthropic 使用非流式但支持工具调用
        const response = await this.callAnthropicAPI(
          config,
          request.instruction,
          request.workspace,
          request.conversationHistory,
          request.mode,
          request.conversationId,
          request.abortSignal,
        );
        onChunk(response);
      } else if (config.provider === 'custom') {
        // 自定义端点，根据协议类型选择
        if (config.apiProtocol === 'anthropic') {
          if ((request.attachments || []).length > 0) {
            throw new Error('当前 provider 暂不支持图片输入，请切换到 OpenAI 兼容模型。');
          }
          const response = await this.callAnthropicAPI(
            config,
            request.instruction,
            request.workspace,
            request.conversationHistory,
            request.mode,
            request.conversationId,
            request.abortSignal,
          );
          onChunk(response);
        } else {
          // 默认使用 OpenAI 协议
          await this.callOpenAIAPIStream(
            config,
            request.instruction,
            request.conversationHistory,
            request.workspace,
            onChunk,
            request.mode,
            request.attachments || [],
            request.conversationId,
            request.abortSignal
          );
        }
      } else {
        appendAgentLog('executor', 'error', '未知的 API 提供商', {
          provider: String(config.provider),
        });
        throw new Error('未知的 API 提供商');
      }
    } catch (error: any) {
      throw error;
    }
  }
}
