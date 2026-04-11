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
    // Load memories and inject into the system prompt.
    let systemContent =
      'You are a professional AI assistant that helps users complete tasks accurately. You can remember relevant prior conversation context.';
    systemContent +=
      `\n\n# Workspace\nCurrent working directory (must be respected): ${workspace}\n` +
      'All filesystem and command-line operations must use this directory as the working directory.\n' +
      'For read_file / write_file / file_edit, file_path must be relative to this directory (for example hello.all, src/a.ts). Do not rewrite absolute paths by replacing "/" with dotted notation like .Users.xxx.xxx.\n' +
      'When issuing multiple agent calls in one turn, do not run them in parallel if they write to the same file_path (can overwrite). Split across turns or aggregate in main session and write once.\n' +
      'When running git clone without a user-specified destination, explicitly clone into this working directory (for example: git clone <repo> "<working-directory>/<repo-name>").';

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
          systemContent += 'Installed and invocable local skills (aligned with skill center):\n';
          systemContent += invocableSkills.join('\n');
          systemContent +=
            '\n\nWhen users ask to list currently available skills, you must call the `skill` tool with `skill_name` set to `list-skills` and return local installed skills from the list above. ' +
            'Do not use `find-skills-in-tencent-skillhub` or other SkillHub/skillhub CLI skills for this purpose (those are only for searching/installing remote marketplace skills and depend on local skillhub/jq).';
        } else {
          systemContent += '\n\n# Available Skills\nThere are currently no invocable installed skills.';
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
    console.log(`[Executor] Registered tool count: ${tools.length}`);
    console.log('[Executor] Tool list:', tools.map((t) => t.name).join(', '));

    const toolsParam = tools.length > 0 ? tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
      }
    })) : undefined;

    console.log('[Executor] Tool payload sent to API:', JSON.stringify(toolsParam, null, 2));
    const maxToolRounds = 20;
    for (let round = 0; round < maxToolRounds; round++) {
      appendAgentLog('executor', 'debug', `OpenAI stream round ${round + 1} request`, {
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
        appendAgentLog('executor', 'error', 'OpenAI stream API call failed', {
          status: response.status,
          bodyPreview: truncateText(error, 300),
          round: round + 1,
        });
        throw new Error(`API call failed: ${response.status} ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      /** Reasoning content for models that emit thinking in tool-call rounds. */
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

      // No tool calls in this round means final answer is ready.
      if (resolvedToolCalls.length === 0) {
        console.log(`[Executor] No tool calls detected in round ${round + 1}, stream completed`);
        appendAgentLog('executor', 'info', `OpenAI stream round ${round + 1} finished (no tool calls)`, {
          assistantChars: assistantContent.length,
        });
        return;
      }

      console.log(`[Executor] Detected ${resolvedToolCalls.length} tool calls in round ${round + 1}`);
      appendAgentLog('executor', 'info', `OpenAI stream round ${round + 1}: tool calls`, {
        tools: resolvedToolCalls.map((c) => c.function?.name || '(unknown)').join(', '),
        count: resolvedToolCalls.length,
      });
      onChunk('\n\n[Executing tool calls...]\n');

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
        appendAgentLog('executor', 'info', `Tool call: ${m.toolName}`, {
          argsPreview: truncateText(m.rawArguments, 500),
          ...(filePath ? { file_path: filePath } : {}),
        });
        onChunk(`\n🔧 Calling tool: ${m.toolName}\n`);

        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace,
          mode,
          conversationId,
          abortSignal,
        });

        if (toolResult.isError) {
          appendAgentLog('executor', 'warn', `Tool result: ${m.toolName}`, {
            resultPreview: truncateText(toolResult.content, 400),
            ...(filePath ? { file_path: filePath } : {}),
          });
          onChunk(`\n❌ ${toolResult.content}\n`);
        } else {
          appendAgentLog('executor', 'debug', `Tool result: ${m.toolName}`, {
            resultPreview: truncateText(toolResult.content, 400),
            ...(filePath ? { file_path: filePath } : {}),
          });
          onChunk(`\n✅ Tool executed successfully: ${toolResult.content}\n`);
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

      console.log(`[Executor] Tool calls completed in round ${round + 1}, requesting next output`);
      onChunk('\n\n[Tool calls completed, continuing generation...]\n');
    }

    onChunk('\n⚠️ Tool-call round limit reached, auto-continue stopped.\n');
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

    let anthropicSystem = `You are a professional AI assistant that helps users complete tasks accurately. You can remember relevant prior conversation context.
Current working directory (must be respected): ${workspace || process.cwd()}
All filesystem and command-line operations must be executed within this working directory.
For read_file / write_file / file_edit, file_path must be relative to this directory (for example hello.all). Do not rewrite absolute paths by replacing "/" with dotted notation like .Users.xxx.xxx.
If multiple agent calls in the same turn would write to the same file_path, do not run them in parallel. Split turns or merge in the main session and write once.
When running git clone without a user-specified destination, explicitly clone into this working directory (for example: git clone <repo> "<working-directory>/<repo-name>").`;
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

    return `${finalText}\n\n⚠️ Tool-call round limit reached, auto-continue stopped.`.trim();
  }

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Load model configuration
      const config = await this.loadModelConfig();

      if (!config || !config.apiKey) {
        const error = 'Please configure API Key in settings first';
        appendAgentLog('executor', 'warn', 'execute skipped: API Key not configured');
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

      appendAgentLog('executor', 'info', 'TaskExecutor.execute started', {
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
          throw new Error('Current provider does not support image input. Switch to an OpenAI-compatible model.');
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
        // Custom endpoint, route by protocol type
        if (config.apiProtocol === 'anthropic') {
          if ((request.attachments || []).length > 0) {
            throw new Error('Current provider does not support image input. Switch to an OpenAI-compatible model.');
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
          // Default to OpenAI protocol
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
        const error = 'Unknown API provider';
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

      // Emit task completion event
      eventBridge.notifyTaskComplete(taskId, {
        taskName: request.instruction.substring(0, 50),
        result: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
        duration: Date.now() - startTime,
        status: 'success',
      });

      appendAgentLog('executor', 'info', 'TaskExecutor.execute completed', {
        durationMs: Date.now() - startTime,
        responseChars: response.length,
      });
      return {
        output: response,
        files: []
      };
    } catch (error: any) {
      // Emit task failure event
      eventBridge.notifyTaskComplete(taskId, {
        taskName: request.instruction.substring(0, 50),
        error: error.message,
        duration: Date.now() - startTime,
        status: 'failed',
      });

      appendAgentLog('executor', 'error', 'TaskExecutor.execute failed', {
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
        throw new Error('Please configure model API key first (~/.squid/config.json -> model.apiKey).');
      }
      if (!fileConfig.provider?.trim()) {
        throw new Error('Please configure model provider first (~/.squid/config.json -> model.provider).');
      }
      const config: ModelConfig = fileConfig as ModelConfig;

      console.log(
        '[LLM] TaskExecutor.executeStream -> call model provider=%s model=%s',
        config.provider,
        config.modelName || '(default)'
      );

      appendAgentLog('executor', 'info', 'TaskExecutor.executeStream call model', {
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
          throw new Error('Current provider does not support image input. Switch to an OpenAI-compatible model.');
        }
        // Anthropic uses non-stream mode with tool calls
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
        // Custom endpoint, route by protocol type
        if (config.apiProtocol === 'anthropic') {
          if ((request.attachments || []).length > 0) {
            throw new Error('Current provider does not support image input. Switch to an OpenAI-compatible model.');
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
          // Default to OpenAI protocol
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
        appendAgentLog('executor', 'error', 'Unknown API provider', {
          provider: String(config.provider),
        });
        throw new Error('Unknown API provider');
      }
    } catch (error: any) {
      throw error;
    }
  }
}
