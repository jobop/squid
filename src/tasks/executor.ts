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
import { appendAgentLog, truncateMiddleText, truncateText } from '../utils/agent-execution-log';
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
import {
  buildToolConsistencyRemediationMessage,
  checkToolInvocationConsistency,
  type ToolExecutionRecord,
  type ToolSelectionRecord,
} from './tool-invocation-consistency';
import {
  mergeOpenAIStreamToolCallDelta,
  normalizeOpenAIMessageToolCalls,
} from './openai-tool-call-normalizer';
import {
  RoundContextCompactor,
  classifyToolRetention,
  loadRoundCompactOptionsFromEnv,
  type RoundToolRecord,
} from './round-context-compactor';
import { contentCharLength } from '../tools/tool-output-format';
import { appendLlmIoFileLog } from '../utils/llm-io-file-log';

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

function summarizeNameList(names: string[], maxItems = 12): string {
  if (!names.length) return '(none)';
  if (names.length <= maxItems) return names.join(', ');
  return `${names.slice(0, maxItems).join(', ')} ... (+${names.length - maxItems})`;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw && raw.trim() ? raw : '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildToolInvocationHardBlockMessage(reason?: string): string {
  const reasonText = reason ? `归因: ${reason}` : '归因: unknown';
  return [
    '⚠️ 检测到“声明已调用工具”与执行事实不一致，已阻断本轮结论。',
    reasonText,
    '请先发起真实工具调用并基于工具结果作答，禁止“只提不调”。',
  ].join('\n');
}

function isLlmIoLogEnabled(): boolean {
  const raw = (process.env.SQUID_LOG_LLM_IO || '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

function isLlmIoFullLogEnabled(): boolean {
  if (!isLlmIoLogEnabled()) return false;
  const raw = (process.env.SQUID_LOG_LLM_IO_FULL || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function llmIoLogMaxChars(): number {
  const parsed = Number(process.env.SQUID_LOG_LLM_IO_MAX_CHARS || '6000');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6000;
}

function formatJsonForLog(value: unknown): string {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    if (isLlmIoFullLogEnabled()) return raw;
    const max = llmIoLogMaxChars();
    return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
  } catch {
    return '[unserializable]';
  }
}

function countCompactionFlags(records: RoundToolRecord[]): { compacted: number; pruned: number } {
  let compacted = 0;
  let pruned = 0;
  for (const record of records) {
    if (record.compacted) compacted += 1;
    if (record.pruned) pruned += 1;
  }
  return { compacted, pruned };
}

function logRoundCompactionStats(params: {
  provider: 'openai' | 'openai-stream' | 'anthropic';
  requestRound: number;
  toolRound: number;
  records: RoundToolRecord[];
  beforeMessages: number;
  afterMessages: number;
  beforeCompacted: number;
  beforePruned: number;
}): void {
  const { compacted, pruned } = countCompactionFlags(params.records);
  const deltaCompacted = Math.max(compacted - params.beforeCompacted, 0);
  const deltaPruned = Math.max(pruned - params.beforePruned, 0);
  appendAgentLog('executor', 'info', 'Round compaction summary', {
    provider: params.provider,
    requestRound: params.requestRound,
    toolRound: params.toolRound,
    records: params.records.length,
    compactedTotal: compacted,
    prunedTotal: pruned,
    compactedAddedThisRound: deltaCompacted,
    prunedAddedThisRound: deltaPruned,
    messagesBefore: params.beforeMessages,
    messagesAfter: params.afterMessages,
  });
  console.log(
    '[RoundCompaction] provider=%s requestRound=%d toolRound=%d records=%d +compacted=%d +pruned=%d messages=%d->%d',
    params.provider,
    params.requestRound,
    params.toolRound,
    params.records.length,
    deltaCompacted,
    deltaPruned,
    params.beforeMessages,
    params.afterMessages
  );
}

const SKILL_INVOCATION_BLOCKING_POLICY =
  '\n\nSkill invocation policy (blocking): ' +
  'Before answering, first decide whether tool-obtained evidence is required. ' +
  'When a skill matches the user request, this is a BLOCKING REQUIREMENT: invoke the `skill` tool BEFORE generating any other response about the task. ' +
  'If a tool call is required, the next action MUST be a tool call instead of plain-text conclusions. ' +
  'Do not claim completion/verification/success without a corresponding tool call and tool result in this turn. ' +
  'NEVER mention a skill without actually calling the `skill` tool. ' +
  'Do not invoke a skill that is already running. ' +
  'Do not use the `skill` tool for built-in CLI commands (like /help, /clear, etc.).';

function parseSkillSelection(rawArgs: string): { skillName: string; skillArgs?: string } | null {
  const args = parseToolArgs(rawArgs);
  const skillName = typeof args.skill_name === 'string' ? args.skill_name.trim() : '';
  if (!skillName) return null;
  const skillArgs = typeof args.args === 'string' ? truncateMiddleText(args.args, 120) : undefined;
  return {
    skillName,
    skillArgs: skillArgs && skillArgs.length > 0 ? skillArgs : undefined,
  };
}

function makeSkillSelectionRecord(
  selected: { skillName: string; skillArgs?: string },
  toolCallId: string
): ToolSelectionRecord {
  return {
    toolName: 'skill',
    toolCallId,
    argsPreview: selected.skillArgs,
  };
}

function makeToolSelectionRecord(
  toolName: string,
  toolCallId: string,
  rawArguments: string
): ToolSelectionRecord {
  if (toolName === 'skill') {
    const selected = parseSkillSelection(rawArguments);
    if (selected) {
      return makeSkillSelectionRecord(selected, toolCallId);
    }
  }

  return {
    toolName,
    toolCallId,
    argsPreview: rawArguments.trim().length > 0 ? truncateMiddleText(rawArguments, 120) : undefined,
  };
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
  /** 会话级工具压缩状态（跨多次 executeStream 持续累计） */
  toolCompactionState?: ToolCompactionState;
  /** 任务级取消信号（Esc/主动中断） */
  abortSignal?: AbortSignal;
}

export interface ExecuteResult {
  output: string;
  files?: string[];
  error?: string;
}

export interface PersistedToolCompactionRecord {
  round: number;
  toolName: string;
  toolCallId: string;
  rawArguments?: string;
  content: string;
  isError?: boolean;
  compacted?: boolean;
  pruned?: boolean;
  lastReferencedRound?: number;
  tokenBucket?: 'short' | 'mid' | 'long';
  policyTag?: 'always_keep' | 'always_compact' | 'normal';
  anchors?: string[];
}

export interface ToolCompactionState {
  /** 会话级“用户输入轮次”计数：每次 executeTaskStream 请求 +1 */
  roundCounter: number;
  records: PersistedToolCompactionRecord[];
}

export interface ExecuteStreamResult {
  toolCompactionState?: ToolCompactionState;
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

function extractMessageContentAsString(content: unknown): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content ?? '');
  } catch {
    return '';
  }
}

function reviveToolHistoryIntoMessages(
  messages: Array<Record<string, any>>,
  persistedState: ToolCompactionState | undefined
): RoundToolRecord[] {
  if (!persistedState?.records?.length) return [];
  const insertAt = Math.max(messages.length - 1, 1);
  const revived: RoundToolRecord[] = [];
  let offset = 0;
  for (const record of persistedState.records) {
    if (record.pruned) continue;
    const syntheticMessage: Record<string, unknown> = {
      role: 'assistant',
      content: record.content || '',
    };
    messages.splice(insertAt + offset, 0, syntheticMessage);
    offset += 1;
    revived.push({
      round: record.round,
      toolName: record.toolName,
      toolCallId: record.toolCallId,
      rawArguments: record.rawArguments || '',
      retention: classifyToolRetention(record.toolName),
      messageRef: syntheticMessage,
      compacted: record.compacted,
      pruned: record.pruned,
      isError: record.isError,
      lastReferencedRound: record.lastReferencedRound,
      tokenBucket: record.tokenBucket,
      policyTag: record.policyTag,
      anchors: Array.isArray(record.anchors) ? [...record.anchors] : [],
    });
  }
  return revived;
}

function persistRoundToolState(
  records: RoundToolRecord[],
  nextRoundCounter: number
): ToolCompactionState {
  const persisted: PersistedToolCompactionRecord[] = [];
  for (const record of records) {
    const content = extractMessageContentAsString(record.messageRef?.content);
    if (record.pruned || !content.trim()) continue;
    const toolCallId =
      record.toolCallId || `tool_${record.round}_${Math.random().toString(36).slice(2, 8)}`;
    persisted.push({
      round: record.round,
      toolName: record.toolName,
      toolCallId,
      rawArguments: record.rawArguments || '',
      content,
      isError: record.isError,
      compacted: record.compacted,
      pruned: record.pruned,
      lastReferencedRound: record.lastReferencedRound,
      tokenBucket: record.tokenBucket,
      policyTag: record.policyTag,
      anchors: record.anchors || [],
    });
  }
  persisted.sort((a, b) => b.round - a.round);
  return {
    roundCounter: Math.max(0, nextRoundCounter),
    records: persisted.slice(0, 120),
  };
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
      const rawToolResultBlock = tool.mapToolResultToToolResultBlockParam(
        result.data,
        toolUseId
      );
      const rawChars = contentCharLength(rawToolResultBlock.content);
      const processedResult = await processToolResultBlock(
        tool,
        result.data,
        toolUseId,
        sessionId
      );
      const processedChars = contentCharLength(processedResult.content);
      const content = typeof processedResult.content === 'string'
        ? processedResult.content
        : JSON.stringify(processedResult.content);
      const isError = processedResult.is_error === true;

      appendAgentLog('executor', 'debug', 'Tool result sizing', {
        toolName: params.toolName,
        toolResultCharsBefore: rawChars,
        toolResultCharsAfter: processedChars,
        reducedChars: Math.max(rawChars - processedChars, 0),
      });

      return {
        content: content || '',
        isError,
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

    let invocableSkillNames: string[] = [];

    // 仅当本执行器注册了 skill 工具时，才注入技能列表，避免子执行器误导模型触发递归。
    if (this.toolRegistry.get('skill')) {
      try {
        const summaries = await this.skillLoader.listSkillSummaries(workspace);
        const invocableSkills = summaries
          .filter((skill) => skill.userInvocable)
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .sort();
        invocableSkillNames = summaries
          .filter((skill) => skill.userInvocable)
          .map((skill) => skill.name)
          .sort();

        if (invocableSkills.length > 0) {
          systemContent += '\n\n# Available Skills\n';
          systemContent += 'Installed and invocable local skills (aligned with skill center):\n';
          systemContent += invocableSkills.join('\n');
          systemContent +=
            '\n\nFor local skill listing requests, rely on the locally installed skills shown above. ' +
            'Avoid remote marketplace/search skills unless the user explicitly asks for remote discovery or installation.';
          systemContent += SKILL_INVOCATION_BLOCKING_POLICY;
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

    const tools = getToolsForTaskMode(mode, this.toolRegistry);
    const toolNames = tools.map((tool) => tool.name);
    const systemPromptPreview = truncateMiddleText(systemContent, 200);
    const userPromptPreview = truncateMiddleText(instruction, 200);
    appendAgentLog('executor', 'info', 'Prompt summary', {
      systemPromptPreview,
      userPromptPreview,
      toolCount: toolNames.length,
      toolNames: summarizeNameList(toolNames),
      skillCount: invocableSkillNames.length,
      skillNames: summarizeNameList(invocableSkillNames),
    });
    console.log(
      '[LLM] Prompt summary | systemPrompt=%s | userPrompt=%s | tools(%d)=%s | skills(%d)=%s',
      systemPromptPreview,
      userPromptPreview,
      toolNames.length,
      summarizeNameList(toolNames),
      invocableSkillNames.length,
      summarizeNameList(invocableSkillNames)
    );

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
    const roundCompactor = new RoundContextCompactor();
    const roundCompactOptions = loadRoundCompactOptionsFromEnv();
    const roundToolRecords: RoundToolRecord[] = [];

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
    let remediationAttempts = 0;
    for (let round = 0; round < maxToolRounds; round++) {
      const requestPayload = {
        model: config.modelName || 'gpt-4-turbo',
        messages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
        tools: toolsParam,
      };
      if (isLlmIoLogEnabled()) {
        await appendLlmIoFileLog(
          `[LLM-IO] OpenAI request | round=${round + 1}`,
          formatJsonForLog(requestPayload)
        );
      }
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API 调用失败: ${response.status} ${error}`);
      }

      const result = await response.json();
      if (isLlmIoLogEnabled()) {
        await appendLlmIoFileLog(
          `[LLM-IO] OpenAI response | round=${round + 1}`,
          formatJsonForLog(result)
        );
      }
      const message = result.choices?.[0]?.message || {};
      const assistantContent = typeof message.content === 'string' ? message.content : '';
      const assistantReasoning =
        typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
      if (assistantContent) {
        finalText += assistantContent;
      }

      const rawToolCalls = normalizeOpenAIMessageToolCalls(message);
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: rawToolCalls.length > 0 ? rawToolCalls : undefined
      };
      if (rawToolCalls.length > 0) {
        assistantMsg.reasoning_content = assistantReasoning;
      }
      messages.push(assistantMsg);

      const toolMetas: Array<{ toolName: string; rawArguments: string; toolCallId: string }> = rawToolCalls.map(
        (toolCall) => ({
          toolName: toolCall.function?.name || '',
          rawArguments: toolCall.function?.arguments || '',
          toolCallId: toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        })
      );
      const selectedTools: ToolSelectionRecord[] = toolMetas.map(
        (m: { toolName: string; rawArguments: string; toolCallId: string }) =>
          makeToolSelectionRecord(
            m.toolName,
            m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            m.rawArguments
          )
      );
      const executedTools: ToolExecutionRecord[] = [];

      if (rawToolCalls.length === 0) {
        const consistency = checkToolInvocationConsistency({
          assistantText: assistantContent,
          selectedTools,
          executedTools,
        });
        const remediation = buildToolConsistencyRemediationMessage(consistency);
        if (consistency.status === 'warning') {
          appendAgentLog('executor', 'warn', 'Tool invocation consistency warning', {
            provider: 'openai',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
          });
          if (remediation && remediationAttempts < 2) {
            remediationAttempts += 1;
            messages.push({
              role: 'user',
              content: remediation,
            });
            continue;
          }
          const hardBlockMessage = buildToolInvocationHardBlockMessage(consistency.reason);
          appendAgentLog('executor', 'warn', 'Tool invocation hard block', {
            provider: 'openai',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
            remediationAttempts,
          });
          return hardBlockMessage;
        }
        return finalText || '';
      }

      const batches = this.buildToolExecutionBatches(toolMetas, workspace);

      const runOne = async (m: ToolCallPartitionItem) => {
        const selectedSkill = m.toolName === 'skill' ? parseSkillSelection(m.rawArguments) : null;
        const toolCallId = m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (selectedSkill) {
          appendAgentLog('executor', 'info', 'Skill selected', {
            provider: 'openai',
            round: round + 1,
            skillName: selectedSkill.skillName,
            skillArgsPreview: selectedSkill.skillArgs,
            toolCallId,
          });
        }
        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace,
          mode,
          conversationId,
        });
        if (selectedSkill) {
          executedTools.push({
            toolName: m.toolName,
            toolCallId,
            argsPreview: selectedSkill.skillArgs,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        } else {
          executedTools.push({
            toolName: m.toolName,
            toolCallId,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        }
        return {
          tool_call_id: toolCallId,
          content: toolResult.content,
        };
      };

      const toolOut = await executePartitionedBatches(batches, runOne);

      const consistency = checkToolInvocationConsistency({
        assistantText: assistantContent,
        selectedTools,
        executedTools,
      });
      const remediation = buildToolConsistencyRemediationMessage(consistency);
      if (selectedTools.length > 0 || consistency.status === 'warning') {
        appendAgentLog(
          'executor',
          consistency.status === 'warning' ? 'warn' : 'info',
          'Tool invocation consistency',
          {
            provider: 'openai',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
            failedToolNames: consistency.failedToolNames,
            records: executedTools,
          }
        );
      }

      for (const row of toolOut) {
        const toolMessage: Record<string, unknown> = {
          role: 'tool',
          tool_call_id: row.tool_call_id,
          content: row.content,
        };
        messages.push(toolMessage);
        const selected = selectedTools.find((item) => item.toolCallId === row.tool_call_id);
        const executed = executedTools.find((item) => item.toolCallId === row.tool_call_id);
        const meta = toolMetas.find((item) => item.toolCallId === row.tool_call_id);
        roundToolRecords.push({
          round: round + 1,
          toolName: selected?.toolName || '',
          toolCallId: row.tool_call_id,
          rawArguments: meta?.rawArguments || '',
          retention: classifyToolRetention(selected?.toolName || ''),
          messageRef: toolMessage,
          isError: executed?.status === 'failed',
        });
      }

      if (consistency.status === 'warning' && remediation && remediationAttempts < 2) {
        remediationAttempts += 1;
        messages.push({
          role: 'user',
          content: remediation,
        });
      }

      const beforeMessages = messages.length;
      const beforeFlags = countCompactionFlags(roundToolRecords);
      roundCompactor.compact(messages, roundToolRecords, round + 1, {
        ...roundCompactOptions,
        referenceAssistantText: assistantContent,
        referenceToolArguments: toolMetas.map((item) => item.rawArguments),
      });
      logRoundCompactionStats({
        provider: 'openai',
        requestRound: round + 1,
        toolRound: round + 1,
        records: roundToolRecords,
        beforeMessages,
        afterMessages: messages.length,
        beforeCompacted: beforeFlags.compacted,
        beforePruned: beforeFlags.pruned,
      });
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
    abortSignal?: AbortSignal,
    persistedToolState?: ToolCompactionState
  ): Promise<ExecuteStreamResult> {
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
    const roundCompactor = new RoundContextCompactor();
    const roundCompactOptions = loadRoundCompactOptionsFromEnv();
    const roundToolRecords: RoundToolRecord[] = reviveToolHistoryIntoMessages(
      messages,
      persistedToolState
    );
    const currentInputRound = Math.max(0, persistedToolState?.roundCounter || 0) + 1;

    const tools = getToolsForTaskMode(mode, this.toolRegistry);
    console.log(
      '[LLM] Tool registry | count=%d names=%s',
      tools.length,
      summarizeNameList(tools.map((t) => t.name))
    );

    const toolsParam = tools.length > 0 ? tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema, { $refStrategy: 'none' })
      }
    })) : undefined;

    const maxToolRounds = 20;
    let remediationAttempts = 0;
    for (let round = 0; round < maxToolRounds; round++) {
      appendAgentLog('executor', 'debug', `OpenAI stream round ${round + 1} request`, {
        toolCount: tools.length,
      });
      const requestPayload = {
        model: config.modelName || 'gpt-4-turbo',
        messages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
        tools: toolsParam,
        stream: true,
      };
      if (isLlmIoLogEnabled()) {
        await appendLlmIoFileLog(
          `[LLM-IO] OpenAI stream request | round=${round + 1}`,
          formatJsonForLog(requestPayload)
        );
      }
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: abortSignal,
        body: JSON.stringify(requestPayload)
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
                if (!toolCall || typeof toolCall !== 'object') continue;
                mergeOpenAIStreamToolCallDelta(
                  toolCalls,
                  toolCall as Record<string, unknown>
                );
              }
            }
          } catch {
            // Skip invalid JSON chunks
          }
        }
      }

      const resolvedToolCalls = toolCalls.filter(Boolean);
      if (isLlmIoLogEnabled()) {
        const aggregatedStreamResult = {
          assistantContent,
          assistantReasoning,
          resolvedToolCalls,
        };
        await appendLlmIoFileLog(
          `[LLM-IO] OpenAI stream response | round=${round + 1} resolvedToolCallCount=${resolvedToolCalls.length}`,
          formatJsonForLog(aggregatedStreamResult)
        );
      }
      const selectedTools: ToolSelectionRecord[] = resolvedToolCalls.map((toolCall) =>
        makeToolSelectionRecord(
          toolCall.function?.name || '',
          toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          toolCall.function?.arguments || ''
        )
      );
      const executedTools: ToolExecutionRecord[] = [];

      // No tool calls in this round means final answer is ready.
      if (resolvedToolCalls.length === 0) {
        const consistency = checkToolInvocationConsistency({
          assistantText: assistantContent,
          selectedTools,
          executedTools,
        });
        const remediation = buildToolConsistencyRemediationMessage(consistency);
        if (consistency.status === 'warning') {
          appendAgentLog('executor', 'warn', 'Tool invocation consistency warning', {
            provider: 'openai-stream',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
          });
          if (remediation && remediationAttempts < 2) {
            remediationAttempts += 1;
            messages.push({
              role: 'user',
              content: remediation,
            });
            onChunk('\n\n[Detected tool-claim inconsistency, requesting tool invocation...]\n');
            continue;
          }
          const hardBlockMessage = buildToolInvocationHardBlockMessage(consistency.reason);
          appendAgentLog('executor', 'warn', 'Tool invocation hard block', {
            provider: 'openai-stream',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            remediationAttempts,
          });
          onChunk(`\n\n${hardBlockMessage}\n`);
          const beforeMessages = messages.length;
          const beforeFlags = countCompactionFlags(roundToolRecords);
          roundCompactor.compact(messages, roundToolRecords, currentInputRound, {
            ...roundCompactOptions,
            referenceAssistantText: assistantContent,
            referenceToolArguments: [],
          });
          logRoundCompactionStats({
            provider: 'openai-stream',
            requestRound: round + 1,
            toolRound: currentInputRound,
            records: roundToolRecords,
            beforeMessages,
            afterMessages: messages.length,
            beforeCompacted: beforeFlags.compacted,
            beforePruned: beforeFlags.pruned,
          });
          return {
            toolCompactionState: persistRoundToolState(roundToolRecords, currentInputRound),
          };
        }
        console.log(`[Executor] No tool calls detected in round ${round + 1}, stream completed`);
        appendAgentLog('executor', 'info', `OpenAI stream round ${round + 1} finished (no tool calls)`, {
          assistantChars: assistantContent.length,
        });
        const beforeMessages = messages.length;
        const beforeFlags = countCompactionFlags(roundToolRecords);
        roundCompactor.compact(messages, roundToolRecords, currentInputRound, {
          ...roundCompactOptions,
          referenceAssistantText: assistantContent,
          referenceToolArguments: [],
        });
        logRoundCompactionStats({
          provider: 'openai-stream',
          requestRound: round + 1,
          toolRound: currentInputRound,
          records: roundToolRecords,
          beforeMessages,
          afterMessages: messages.length,
          beforeCompacted: beforeFlags.compacted,
          beforePruned: beforeFlags.pruned,
        });
        return {
          toolCompactionState: persistRoundToolState(roundToolRecords, currentInputRound),
        };
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
        const filePath = filePathFromRawToolArgs(m.rawArguments);
        const selectedSkill = m.toolName === 'skill' ? parseSkillSelection(m.rawArguments) : null;
        appendAgentLog('executor', 'info', `Tool call: ${m.toolName}`, {
          argsPreview: truncateMiddleText(m.rawArguments, 200),
          ...(filePath ? { file_path: filePath } : {}),
        });
        console.log('[LLM] Selected tool | round=%d tool=%s', round + 1, m.toolName);
        if (selectedSkill) {
          appendAgentLog('executor', 'info', `Skill selected: ${selectedSkill.skillName}`, {
            skillName: selectedSkill.skillName,
            skillArgsPreview: selectedSkill.skillArgs,
          });
          console.log(
            '[LLM] Selected skill | name=%s args=%s',
            selectedSkill.skillName,
            selectedSkill.skillArgs || '(none)'
          );
        }
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
          const errorPreview = truncateMiddleText(toolResult.content, 200);
          appendAgentLog('executor', 'warn', `Tool result: ${m.toolName}`, {
            resultPreview: errorPreview,
            ...(filePath ? { file_path: filePath } : {}),
          });
          console.log(
            '[LLM] Tool execution | tool=%s status=failed error=%s',
            m.toolName,
            errorPreview
          );
          if (selectedSkill) {
            console.log(
              '[LLM] Skill execution | skill=%s status=failed error=%s',
              selectedSkill.skillName,
              errorPreview
            );
          }
          onChunk(`\n❌ Tool failed: ${m.toolName} | ${errorPreview}\n`);
        } else {
          appendAgentLog('executor', 'debug', `Tool result: ${m.toolName}`, {
            resultPreview: truncateMiddleText(toolResult.content, 200),
            ...(filePath ? { file_path: filePath } : {}),
          });
          console.log('[LLM] Tool execution | tool=%s status=ok', m.toolName);
          if (selectedSkill) {
            console.log('[LLM] Skill execution | skill=%s status=ok', selectedSkill.skillName);
          }
          onChunk(`\n✅ Tool executed: ${m.toolName}\n`);
        }

        if (selectedSkill) {
          executedTools.push({
            toolName: m.toolName,
            toolCallId: m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            argsPreview: selectedSkill.skillArgs,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        } else {
          executedTools.push({
            toolName: m.toolName,
            toolCallId: m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        }

        return {
          tool_call_id: m.toolCallId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          content: toolResult.content,
        };
      };

      const streamOut = await executePartitionedBatches(streamBatches, runStreamOne);
      const consistency = checkToolInvocationConsistency({
        assistantText: assistantContent,
        selectedTools,
        executedTools,
      });
      const remediation = buildToolConsistencyRemediationMessage(consistency);
      if (selectedTools.length > 0 || consistency.status === 'warning') {
        appendAgentLog(
          'executor',
          consistency.status === 'warning' ? 'warn' : 'info',
          'Tool invocation consistency',
          {
            provider: 'openai-stream',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
            failedToolNames: consistency.failedToolNames,
            records: executedTools,
          }
        );
      }

      for (const row of streamOut) {
        const toolMessage: Record<string, unknown> = {
          role: 'tool',
          tool_call_id: row.tool_call_id,
          content: row.content,
        };
        messages.push(toolMessage);
        const selected = selectedTools.find((item) => item.toolCallId === row.tool_call_id);
        const executed = executedTools.find((item) => item.toolCallId === row.tool_call_id);
        const meta = streamMetas.find((item) => item.toolCallId === row.tool_call_id);
        roundToolRecords.push({
          round: currentInputRound,
          toolName: selected?.toolName || '',
          toolCallId: row.tool_call_id,
          rawArguments: meta?.rawArguments || '',
          retention: classifyToolRetention(selected?.toolName || ''),
          messageRef: toolMessage,
          isError: executed?.status === 'failed',
        });
      }

      if (consistency.status === 'warning' && remediation && remediationAttempts < 2) {
        remediationAttempts += 1;
        messages.push({
          role: 'user',
          content: remediation,
        });
        onChunk('\n\n[Detected tool execution inconsistency, asking model to retry tool call...]\n');
      }

      const beforeMessages = messages.length;
      const beforeFlags = countCompactionFlags(roundToolRecords);
      roundCompactor.compact(messages, roundToolRecords, currentInputRound, {
        ...roundCompactOptions,
        referenceAssistantText: assistantContent,
        referenceToolArguments: streamMetas.map((item) => item.rawArguments),
      });
      logRoundCompactionStats({
        provider: 'openai-stream',
        requestRound: round + 1,
        toolRound: currentInputRound,
        records: roundToolRecords,
        beforeMessages,
        afterMessages: messages.length,
        beforeCompacted: beforeFlags.compacted,
        beforePruned: beforeFlags.pruned,
      });

      console.log(`[Executor] Tool calls completed in round ${round + 1}, requesting next output`);
      onChunk('\n\n[Tool calls completed, continuing generation...]\n');
    }

    onChunk('\n⚠️ Tool-call round limit reached, auto-continue stopped.\n');
    return {
      toolCompactionState: persistRoundToolState(roundToolRecords, currentInputRound),
    };
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
    const roundCompactor = new RoundContextCompactor();
    const roundCompactOptions = loadRoundCompactOptionsFromEnv();
    const roundToolRecords: RoundToolRecord[] = [];

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
    let remediationAttempts = 0;
    let anthropicSystem = `You are a professional AI assistant that helps users complete tasks accurately. You can remember relevant prior conversation context.
Current working directory (must be respected): ${workspace || process.cwd()}
All filesystem and command-line operations must be executed within this working directory.
For read_file / write_file / file_edit, file_path must be relative to this directory (for example hello.all). Do not rewrite absolute paths by replacing "/" with dotted notation like .Users.xxx.xxx.
If multiple agent calls in the same turn would write to the same file_path, do not run them in parallel. Split turns or merge in the main session and write once.
When running git clone without a user-specified destination, explicitly clone into this working directory (for example: git clone <repo> "<working-directory>/<repo-name>").`;
    if (mode === 'plan') {
      anthropicSystem += getPlanModeSystemAppendix(workspace || process.cwd(), conversationId);
    }

    let invocableSkillNames: string[] = [];
    if (this.toolRegistry.get('skill')) {
      try {
        const invocableSkills = (await this.skillLoader.listSkillSummaries(workspace || process.cwd()))
          .filter((skill) => skill.userInvocable)
          .sort((a, b) => a.name.localeCompare(b.name));
        invocableSkillNames = invocableSkills.map((skill) => skill.name);
        if (invocableSkills.length > 0) {
          anthropicSystem += '\n\n# Available Skills\n';
          anthropicSystem += 'Installed and invocable local skills:\n';
          anthropicSystem += invocableSkills
            .map((skill) => `- ${skill.name}: ${skill.description}`)
            .join('\n');
          anthropicSystem += SKILL_INVOCATION_BLOCKING_POLICY;
        }
      } catch {
        invocableSkillNames = [];
      }
    }

    appendAgentLog('executor', 'info', 'Prompt summary', {
      systemPromptPreview: truncateMiddleText(anthropicSystem, 200),
      userPromptPreview: truncateMiddleText(instruction, 200),
      toolCount: tools.length,
      toolNames: summarizeNameList(tools.map((tool) => tool.name)),
      skillCount: invocableSkillNames.length,
      skillNames: summarizeNameList(invocableSkillNames),
    });
    console.log(
      '[LLM] Prompt summary | systemPrompt=%s | userPrompt=%s | tools(%d)=%s | skills(%d)=%s',
      truncateMiddleText(anthropicSystem, 200),
      truncateMiddleText(instruction, 200),
      tools.length,
      summarizeNameList(tools.map((tool) => tool.name)),
      invocableSkillNames.length,
      summarizeNameList(invocableSkillNames)
    );

    for (let round = 0; round < maxToolRounds; round++) {
      const requestPayload = {
        model: config.modelName || 'claude-3-5-sonnet-20241022',
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
        system: anthropicSystem,
        messages,
        tools: toolsParam,
      };
      if (isLlmIoLogEnabled()) {
        await appendLlmIoFileLog(
          `[LLM-IO] Anthropic request | round=${round + 1}`,
          formatJsonForLog(requestPayload)
        );
      }
      const response = await fetch(`${endpoint}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        signal: abortSignal,
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API 调用失败: ${response.status} ${error}`);
      }

      const result = await response.json();
      if (isLlmIoLogEnabled()) {
        await appendLlmIoFileLog(
          `[LLM-IO] Anthropic response | round=${round + 1}`,
          formatJsonForLog(result)
        );
      }
      const contents = Array.isArray(result.content) ? result.content : [];
      const toolUses: Array<{ id: string; name?: string; input?: unknown }> = contents
        .filter((content: any) => content.type === 'tool_use')
        .map((content: any) => ({
          id: typeof content.id === 'string' ? content.id : '',
          name: typeof content.name === 'string' ? content.name : undefined,
          input: content.input,
        }))
        .filter((content: { id: string }) => content.id.length > 0);
      const selectedTools: ToolSelectionRecord[] = toolUses.map(
        (toolUse: { id: string; name?: string; input?: unknown }) =>
          makeToolSelectionRecord(
            toolUse.name || '',
            toolUse.id,
            JSON.stringify(toolUse.input || {})
          )
      );
      const executedTools: ToolExecutionRecord[] = [];
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
        const consistency = checkToolInvocationConsistency({
          assistantText: text,
          selectedTools,
          executedTools,
        });
        const remediation = buildToolConsistencyRemediationMessage(consistency);
        if (consistency.status === 'warning') {
          appendAgentLog('executor', 'warn', 'Tool invocation consistency warning', {
            provider: 'anthropic',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
          });
          if (remediation && remediationAttempts < 2) {
            remediationAttempts += 1;
            messages.push({
              role: 'user',
              content: remediation,
            });
            continue;
          }
          const hardBlockMessage = buildToolInvocationHardBlockMessage(consistency.reason);
          appendAgentLog('executor', 'warn', 'Tool invocation hard block', {
            provider: 'anthropic',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
            remediationAttempts,
          });
          return hardBlockMessage;
        }
        return finalText || '';
      }

      appendAgentLog('executor', 'info', `Anthropic round ${round + 1}: tool calls`, {
        count: toolUses.length,
        tools: summarizeNameList(
          toolUses.map((toolUse: { name?: string }) => toolUse.name || '(unknown)')
        ),
      });
      console.log(
        '[LLM] Selected tools | round=%d count=%d names=%s',
        round + 1,
        toolUses.length,
        summarizeNameList(
          toolUses.map((toolUse: { name?: string }) => toolUse.name || '(unknown)')
        )
      );

      const anthropicMetas = toolUses.map((toolUse: { id: string; name?: string; input?: unknown }) => ({
        toolName: toolUse.name || '',
        rawArguments: JSON.stringify(toolUse.input || {}),
        toolUseId: toolUse.id,
      }));

      const ws = workspace || process.cwd();
      const anthropicBatches = this.buildToolExecutionBatches(anthropicMetas, ws);

      const runAnthropicOne = async (m: ToolCallPartitionItem) => {
        const selectedSkill = m.toolName === 'skill' ? parseSkillSelection(m.rawArguments) : null;
        const toolUseId = m.toolUseId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        appendAgentLog('executor', 'info', `Tool call: ${m.toolName}`, {
          argsPreview: truncateMiddleText(m.rawArguments, 200),
        });
        console.log('[LLM] Selected tool | round=%d tool=%s', round + 1, m.toolName);
        if (selectedSkill) {
          appendAgentLog('executor', 'info', `Skill selected: ${selectedSkill.skillName}`, {
            skillName: selectedSkill.skillName,
            skillArgsPreview: selectedSkill.skillArgs,
          });
          console.log(
            '[LLM] Selected skill | name=%s args=%s',
            selectedSkill.skillName,
            selectedSkill.skillArgs || '(none)'
          );
        }
        const toolResult = await this.executeToolAndFormatResult({
          toolName: m.toolName,
          rawArguments: m.rawArguments,
          workspace: ws,
          mode,
          conversationId,
          abortSignal,
        });
        appendAgentLog('executor', toolResult.isError ? 'warn' : 'debug', `Tool result: ${m.toolName}`, {
          resultPreview: truncateMiddleText(toolResult.content, 200),
        });
        const errorPreview = toolResult.isError ? truncateMiddleText(toolResult.content, 200) : '';
        if (toolResult.isError) {
          console.log(
            '[LLM] Tool execution | tool=%s status=failed error=%s',
            m.toolName,
            errorPreview
          );
        } else {
          console.log('[LLM] Tool execution | tool=%s status=ok', m.toolName);
        }
        if (selectedSkill) {
          if (toolResult.isError) {
            console.log(
              '[LLM] Skill execution | skill=%s status=failed error=%s',
              selectedSkill.skillName,
              errorPreview
            );
          } else {
            console.log('[LLM] Skill execution | skill=%s status=ok', selectedSkill.skillName);
          }
          executedTools.push({
            toolName: m.toolName,
            toolCallId: toolUseId,
            argsPreview: selectedSkill.skillArgs,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        } else {
          executedTools.push({
            toolName: m.toolName,
            toolCallId: toolUseId,
            status: toolResult.isError ? 'failed' : 'ok',
            errorPreview: toolResult.isError ? truncateMiddleText(toolResult.content, 200) : undefined,
          });
        }
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseId,
          content: toolResult.content,
          is_error: toolResult.isError,
        };
      };

      const toolResults = await executePartitionedBatches(anthropicBatches, runAnthropicOne);
      const consistency = checkToolInvocationConsistency({
        assistantText: text,
        selectedTools,
        executedTools,
      });
      const remediation = buildToolConsistencyRemediationMessage(consistency);
      if (selectedTools.length > 0 || consistency.status === 'warning') {
        appendAgentLog(
          'executor',
          consistency.status === 'warning' ? 'warn' : 'info',
          'Tool invocation consistency',
          {
            provider: 'anthropic',
            round: round + 1,
            reason: consistency.reason,
            claimSignals: consistency.claimSignals,
            selectedToolNames: consistency.selectedToolNames,
            executedToolNames: consistency.executedToolNames,
            failedToolNames: consistency.failedToolNames,
            records: executedTools,
          }
        );
      }

      const toolResultsMessage: Record<string, unknown> = {
        role: 'user',
        content: toolResults
      };
      messages.push(toolResultsMessage);
      for (let i = 0; i < toolResults.length; i++) {
        const item = toolResults[i];
        if (!item || item.type !== 'tool_result') continue;
        const selected = selectedTools.find((s) => s.toolCallId === item.tool_use_id);
        const executed = executedTools.find((s) => s.toolCallId === item.tool_use_id);
        const meta = anthropicMetas.find((s) => s.toolUseId === item.tool_use_id);
        roundToolRecords.push({
          round: round + 1,
          toolName: selected?.toolName || '',
          toolCallId: item.tool_use_id,
          rawArguments: meta?.rawArguments || '',
          retention: classifyToolRetention(selected?.toolName || ''),
          messageRef: toolResultsMessage,
          blockIndex: i,
          isError: executed?.status === 'failed',
        });
      }
      if (consistency.status === 'warning' && remediation && remediationAttempts < 2) {
        remediationAttempts += 1;
        messages.push({
          role: 'user',
          content: remediation,
        });
      }

      const beforeMessages = messages.length;
      const beforeFlags = countCompactionFlags(roundToolRecords);
      roundCompactor.compact(messages, roundToolRecords, round + 1, {
        ...roundCompactOptions,
        referenceAssistantText: text,
        referenceToolArguments: anthropicMetas.map((item) => item.rawArguments),
      });
      logRoundCompactionStats({
        provider: 'anthropic',
        requestRound: round + 1,
        toolRound: round + 1,
        records: roundToolRecords,
        beforeMessages,
        afterMessages: messages.length,
        beforeCompacted: beforeFlags.compacted,
        beforePruned: beforeFlags.pruned,
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
        // Custom endpoint, route by protocol type
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

  async executeStream(
    request: ExecuteRequest,
    onChunk: (chunk: string) => void
  ): Promise<ExecuteStreamResult> {
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
        return await this.callOpenAIAPIStream(
          config,
          request.instruction,
          request.conversationHistory,
          request.workspace,
          onChunk,
          request.mode,
          request.attachments || [],
          request.conversationId,
          request.abortSignal,
          request.toolCompactionState
        );
      } else if (config.provider === 'anthropic') {
        if ((request.attachments || []).length > 0) {
          throw new Error('当前 provider 暂不支持图片输入，请切换到 OpenAI 兼容模型。');
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
        return { toolCompactionState: request.toolCompactionState };
      } else if (config.provider === 'custom') {
        // Custom endpoint, route by protocol type
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
          return { toolCompactionState: request.toolCompactionState };
        } else {
          // Default to OpenAI protocol
          return await this.callOpenAIAPIStream(
            config,
            request.instruction,
            request.conversationHistory,
            request.workspace,
            onChunk,
            request.mode,
            request.attachments || [],
            request.conversationId,
            request.abortSignal,
            request.toolCompactionState
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
