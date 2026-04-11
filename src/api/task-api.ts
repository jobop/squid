// Task execution API
import { TaskExecutor } from '../tasks/executor';
import { type ImageAttachment, TaskMode } from '../tasks/types';
import { WorkspaceSandbox } from '../workspace/sandbox';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';
import { ExpertManager } from '../experts/manager';
import type { Expert } from '../experts/types';
import { ConversationManager } from '../conversation/manager';
import type { Message as ConversationMessage } from '../conversation/manager';
import { MemoryManager } from '../memory/manager';
import type { MemoryCreateInput, MemoryUpdateInput } from '../memory/types';
import { saveMemoryTool } from '../tools/save-memory';
import { WebFetchTool } from '../tools/web-fetch';
import { FileEditTool } from '../tools/file-edit';
import { WriteFileTool } from '../tools/write-file';
import { BashTool } from '../tools/bash';
import { PowerShellTool } from '../tools/powershell';
import { WebSearchTool } from '../tools/web-search';
import {
  readWebSearchProviderRawFromSquidConfigRoot,
  setWebSearchProviderInSquidConfig
} from '../config/tools-config';
import { normalizeWebSearchProvider } from '../tools/web-search-providers';
import { CronCreateTool } from '../tools/cron-create';
import { CronDeleteTool } from '../tools/cron-delete';
import { CronListTool } from '../tools/cron-list';
import { CronStatusTool } from '../tools/cron-status';
import { CronRunsTool } from '../tools/cron-runs';
import { SkillTool } from '../tools/skill';
import { SkillHubInstallTool } from '../tools/skillhub-install';
import { BriefTool } from '../tools/brief';
import { AgentTool } from '../tools/agent';
import { ReadFileTool } from '../tools/read-file';
import { GlobTool } from '../tools/glob';
import { GrepTool } from '../tools/grep';
import { TencentSkillHubClient } from '../skills/tencent-skillhub-client';
import { installTencentSkillHubSkill } from '../skills/tencent-skillhub-installer';
import { getTencentSkillHubInstallStatus, readTencentSkillHubLockfile } from '../skills/tencent-skillhub-metadata';
import type {
  TencentSkillHubCatalogResponse,
  TencentSkillHubInstallResult
} from '../skills/tencent-skillhub-types';
import {
  enqueue,
  enqueuePendingNotification,
  getConversationQueueLength,
  type ChannelQueueReply,
  type QueuedCommand,
  type QueuedCommandSource,
  type QueuePriority,
} from '../utils/messageQueueManager';
import { appendAgentLog, truncateMiddleText, truncateText } from '../utils/agent-execution-log';
import { getSquidProjectRoot } from '../channels/extensions/config';

import { TaskAPIConversationBusyError } from './task-api-channel-errors';

export {
  TaskAPIConversationBusyError,
  isTaskAPIConversationBusyError,
} from './task-api-channel-errors';

export interface SelectedSkillInput {
  name: string;
  args?: string;
}

export interface FileMentionInput {
  type: 'file';
  path: string;
  label?: string;
}

export interface SkillMentionInput {
  type: 'skill';
  name: string;
  args?: string;
  label?: string;
}

export type MentionInput = FileMentionInput | SkillMentionInput;

export interface ImageAttachmentInput {
  type?: 'image';
  mimeType?: string;
  dataUrl?: string;
  base64?: string;
  source?: 'paste' | 'mention';
  name?: string;
  path?: string;
}

export interface TaskRequest {
  mode: TaskMode;
  workspace: string;
  instruction: string;
  apiKey?: string;
  baseURL?: string;
  modelName?: string;
  skill?: string;
  mentions?: MentionInput[];
  attachments?: ImageAttachmentInput[];
  /** 一次性意图：当前请求即便无 conversationId，也应强制创建新线程 */
  startInNewThread?: boolean;
  expertId?: string;
  conversationId?: string;
}

export interface TaskResponse {
  success: boolean;
  output?: string;
  error?: string;
  files?: string[];
  /** 为 true 表示已排入该会话队列，未立即执行 */
  queued?: boolean;
  queuePosition?: number;
  conversationId?: string;
}

export interface TaskListItem {
  id: string;
  instruction: string;
  mode: TaskMode;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  workspace: string;
  expertId?: string;
}

export interface ThreadListItem {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspace?: string;
}

const DEFAULT_CONVERSATION_ID = '__squid_default_conversation__';
const NEW_THREAD_PLACEHOLDER_PREFIX = '__squid_new_thread__:';
const MAX_IMAGE_ATTACHMENTS = 6;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
};

function buildNewThreadPlaceholderConversationId(): string {
  return `${NEW_THREAD_PLACEHOLDER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSyntheticConversationId(raw?: string): string | undefined {
  const id = String(raw || '').trim();
  if (!id) return undefined;
  if (id === DEFAULT_CONVERSATION_ID) return undefined;
  if (id.startsWith(NEW_THREAD_PLACEHOLDER_PREFIX)) return undefined;
  return id;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === 'AbortError') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('aborted') || msg.includes('aborterror');
}

function normalizeFilePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function normalizeMentions(input: unknown): MentionInput[] {
  if (!Array.isArray(input)) return [];
  const out: MentionInput[] = [];
  const seenFile = new Set<string>();
  const seenSkill = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const typeRaw = (item as Record<string, unknown>).type;
    if (typeRaw === 'file') {
      const pathRaw = (item as Record<string, unknown>).path;
      if (typeof pathRaw !== 'string') continue;
      const normalizedPath = normalizeFilePath(pathRaw);
      if (!normalizedPath || seenFile.has(normalizedPath)) continue;
      seenFile.add(normalizedPath);
      const labelRaw = (item as Record<string, unknown>).label;
      out.push({
        type: 'file',
        path: normalizedPath,
        label: typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : undefined,
      });
    } else if (typeRaw === 'skill') {
      const nameRaw = (item as Record<string, unknown>).name;
      if (typeof nameRaw !== 'string') continue;
      const name = nameRaw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenSkill.has(key)) continue;
      seenSkill.add(key);
      const argsRaw = (item as Record<string, unknown>).args;
      const labelRaw = (item as Record<string, unknown>).label;
      out.push({
        type: 'skill',
        name,
        args: typeof argsRaw === 'string' && argsRaw.trim() ? argsRaw.trim() : undefined,
        label: typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : undefined,
      });
    } else {
      continue;
    }
    if (out.length >= 20) break;
  }
  return out;
}

function estimateBase64Bytes(base64: string): number {
  const sanitized = base64.replace(/\s+/g, '');
  if (!sanitized) return 0;
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  return Math.floor((sanitized.length * 3) / 4) - padding;
}

function normalizeMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('image/')) return undefined;
  return normalized;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = normalizeMimeType(match[1]);
  if (!mimeType) return null;
  const base64 = match[2].replace(/\s+/g, '');
  return { mimeType, base64 };
}

function buildImageDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

function normalizeImageAttachments(
  input: unknown
): { ok: true; attachments: ImageAttachment[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: true, attachments: [] };
  }
  if (input.length > MAX_IMAGE_ATTACHMENTS) {
    return { ok: false, error: `图片数量超限，最多允许 ${MAX_IMAGE_ATTACHMENTS} 张` };
  }
  const attachments: ImageAttachment[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (typeof type === 'string' && type !== 'image') continue;

    let mimeType = normalizeMimeType(record.mimeType);
    let base64 = '';
    const rawDataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : '';
    if (rawDataUrl) {
      const parsed = parseDataUrl(rawDataUrl);
      if (!parsed) {
        return { ok: false, error: '图片附件 dataUrl 格式非法，需为 data:image/*;base64,...' };
      }
      if (mimeType && mimeType !== parsed.mimeType) {
        return { ok: false, error: '图片附件 mimeType 与 dataUrl 不一致' };
      }
      mimeType = parsed.mimeType;
      base64 = parsed.base64;
    } else if (typeof record.base64 === 'string' && record.base64.trim()) {
      if (!mimeType) {
        return { ok: false, error: '图片附件缺少 mimeType' };
      }
      base64 = record.base64.replace(/\s+/g, '');
    } else {
      return { ok: false, error: '图片附件缺少 dataUrl/base64 数据' };
    }

    if (!mimeType) {
      return { ok: false, error: '图片附件 mimeType 非法' };
    }
    const bytes = estimateBase64Bytes(base64);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return { ok: false, error: '图片附件内容为空或无效' };
    }
    if (bytes > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `单张图片过大（${Math.round(bytes / 1024)}KB），请控制在 ${Math.round(MAX_IMAGE_ATTACHMENT_BYTES / 1024)}KB 以内`,
      };
    }
    totalBytes += bytes;
    if (totalBytes > MAX_IMAGE_TOTAL_BYTES) {
      return {
        ok: false,
        error: `图片总大小超限，请控制在 ${Math.round(MAX_IMAGE_TOTAL_BYTES / 1024)}KB 以内`,
      };
    }
    const dataUrl = buildImageDataUrl(mimeType, base64);
    if (seen.has(dataUrl)) continue;
    seen.add(dataUrl);
    attachments.push({
      type: 'image',
      mimeType,
      dataUrl,
      source: record.source === 'mention' ? 'mention' : 'paste',
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
      path: typeof record.path === 'string' && record.path.trim() ? normalizeFilePath(record.path) : undefined,
    });
    if (attachments.length > MAX_IMAGE_ATTACHMENTS) {
      return { ok: false, error: `图片数量超限，最多允许 ${MAX_IMAGE_ATTACHMENTS} 张` };
    }
  }
  return { ok: true, attachments };
}

function mergeImageAttachments(primary: ImageAttachment[], secondary: ImageAttachment[]): ImageAttachment[] {
  if (primary.length === 0) return [...secondary];
  if (secondary.length === 0) return [...primary];
  const out: ImageAttachment[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.dataUrl)) continue;
    seen.add(item.dataUrl);
    out.push(item);
  }
  return out;
}

async function resolveImageAttachmentsFromMentionedFiles(
  workspace: string,
  mentions: MentionInput[]
): Promise<{ ok: true; attachments: ImageAttachment[] } | { ok: false; error: string }> {
  const { fileMentions } = splitMentions(mentions);
  if (fileMentions.length === 0) return { ok: true, attachments: [] };
  const { resolve, extname, basename } = await import('path');
  const { readFile, stat } = await import('fs/promises');
  const workspaceAbs = resolve(workspace || process.cwd());
  const attachments: ImageAttachment[] = [];
  let totalBytes = 0;
  for (const mention of fileMentions) {
    const ext = extname(mention.path).toLowerCase();
    const mimeType = IMAGE_MIME_BY_EXT[ext];
    if (!mimeType) continue;
    const absolutePath = resolve(workspaceAbs, mention.path);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) continue;
      if (fileStat.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `图片文件过大: ${mention.path}（${Math.round(fileStat.size / 1024)}KB）`,
        };
      }
      totalBytes += fileStat.size;
      if (totalBytes > MAX_IMAGE_TOTAL_BYTES) {
        return {
          ok: false,
          error: `图片总大小超限，请控制在 ${Math.round(MAX_IMAGE_TOTAL_BYTES / 1024)}KB 以内`,
        };
      }
      const base64 = await readFile(absolutePath, 'base64');
      attachments.push({
        type: 'image',
        mimeType,
        dataUrl: buildImageDataUrl(mimeType, base64),
        source: 'mention',
        name: basename(mention.path),
        path: mention.path,
      });
      if (attachments.length > MAX_IMAGE_ATTACHMENTS) {
        return { ok: false, error: `图片数量超限，最多允许 ${MAX_IMAGE_ATTACHMENTS} 张` };
      }
    } catch {
      return { ok: false, error: `读取图片文件失败: ${mention.path}` };
    }
  }
  return { ok: true, attachments };
}

function splitMentions(mentions: MentionInput[]): {
  fileMentions: FileMentionInput[];
  skillMentions: SkillMentionInput[];
} {
  const fileMentions: FileMentionInput[] = [];
  const skillMentions: SkillMentionInput[] = [];
  for (const mention of mentions) {
    if (mention.type === 'file') fileMentions.push(mention);
    if (mention.type === 'skill') skillMentions.push(mention);
  }
  return { fileMentions, skillMentions };
}

function normalizeSkillMentionsFromMentions(mentions: unknown): SelectedSkillInput[] {
  const out: SelectedSkillInput[] = [];
  const seen = new Set<string>();
  const normalized = normalizeMentions(mentions);
  for (const mention of normalized) {
    if (mention.type !== 'skill') continue;
    const key = mention.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: mention.name,
      args: mention.args,
    });
  }
  return out;
}

function summarizeNameList(names: string[], maxItems = 12): string {
  if (!names.length) return '(none)';
  if (names.length <= maxItems) return names.join(', ');
  return `${names.slice(0, maxItems).join(', ')} ... (+${names.length - maxItems})`;
}

function mergeSelectedSkillsForLog(mentions: MentionInput[], legacySkill?: string): string[] {
  const fromMentions = normalizeSkillMentionsFromMentions(mentions).map((s) => s.name);
  const seen = new Set(fromMentions.map((s) => s.toLowerCase()));
  const merged = [...fromMentions];
  if (typeof legacySkill === 'string' && legacySkill.trim()) {
    const normalized = legacySkill.trim();
    if (!seen.has(normalized.toLowerCase())) {
      merged.unshift(normalized);
    }
  }
  return merged;
}

async function validateMentionsForWorkspaceAndSkills(
  workspace: string,
  mentions: MentionInput[],
  skillLoader: SkillLoader,
  workspaceForSkills?: string
): Promise<{ ok: true; mentions: MentionInput[] } | { ok: false; error: string }> {
  if (mentions.length === 0) return { ok: true, mentions: [] };
  const { fileMentions, skillMentions } = splitMentions(mentions);
  const { resolve, relative, sep } = await import('path');
  const { access, stat } = await import('fs/promises');
  const workspaceAbs = resolve(workspace || process.cwd());
  const validatedFiles = new Map<string, FileMentionInput>();
  for (const mention of fileMentions) {
    const absolutePath = resolve(workspaceAbs, mention.path);
    const rel = relative(workspaceAbs, absolutePath);
    const outside = rel.startsWith('..') || rel.includes(`${sep}..${sep}`) || rel === '..';
    if (outside || rel === '') {
      return {
        ok: false,
        error: `文件引用非法（超出工作目录）: ${mention.path}`,
      };
    }
    try {
      await access(absolutePath);
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        return {
          ok: false,
          error: `文件引用不是普通文件: ${mention.path}`,
        };
      }
      const normalizedPath = normalizeFilePath(rel);
      validatedFiles.set(normalizedPath, {
        type: 'file',
        path: normalizedPath,
        label: mention.label,
      });
    } catch {
      return {
        ok: false,
        error: `文件引用不存在或不可访问: ${mention.path}`,
      };
    }
  }
  const validatedSkills = new Map<string, SkillMentionInput>();
  if (skillMentions.length > 0) {
    const summaries = await skillLoader.listSkillSummaries(workspaceForSkills);
    const invocableByLower = new Map(
      summaries
        .filter((item) => item.userInvocable)
        .map((item) => [item.name.toLowerCase(), item.name] as const)
    );
    for (const mention of skillMentions) {
      const canonical = invocableByLower.get(mention.name.toLowerCase());
      if (!canonical) {
        return {
          ok: false,
          error: `技能引用不可用: ${mention.name}`,
        };
      }
      validatedSkills.set(canonical.toLowerCase(), {
        type: 'skill',
        name: canonical,
        args: mention.args,
        label: mention.label,
      });
    }
  }
  const merged: MentionInput[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (mention.type === 'file') {
      const key = normalizeFilePath(mention.path);
      if (seen.has(`file:${key}`)) continue;
      const validated = validatedFiles.get(key);
      if (!validated) continue;
      seen.add(`file:${key}`);
      merged.push(validated);
      continue;
    }
    const key = mention.name.toLowerCase();
    if (seen.has(`skill:${key}`)) continue;
    const validated = validatedSkills.get(key);
    if (!validated) continue;
    seen.add(`skill:${key}`);
    merged.push(validated);
  }
  return { ok: true, mentions: merged };
}

function buildInstructionWithMentionedFiles(
  instruction: string,
  mentions?: unknown
): string {
  const { fileMentions: files } = splitMentions(normalizeMentions(mentions));
  if (files.length === 0) return instruction;
  const lines = files.map((item) =>
    item.label && item.label !== item.path
      ? `- ${item.path} (label: ${item.label})`
      : `- ${item.path}`
  );
  const instructionBody = instruction.includes('## User Instruction')
    ? instruction
    : ['## User Instruction', instruction].join('\n');
  return [
    '## User Mentioned Files',
    'User explicitly selected these workspace files. Use them as high-priority context when relevant.',
    ...lines,
    '',
    instructionBody,
  ].join('\n');
}

function buildInstructionWithSelectedSkills(
  instruction: string,
  mentions?: unknown,
  legacySkill?: string
): string {
  const mentionPicked = normalizeSkillMentionsFromMentions(mentions);
  const merged: SelectedSkillInput[] = [...mentionPicked];
  const seen = new Set(mentionPicked.map((s) => s.name.toLowerCase()));
  if (typeof legacySkill === 'string' && legacySkill.trim()) {
    const n = legacySkill.trim();
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      merged.unshift({ name: n });
      seen.add(k);
    }
  }
  if (merged.length === 0) return instruction;

  const lines = merged.map((s) =>
    s.args ? `- ${s.name} (args: ${s.args})` : `- ${s.name}`
  );
  const instructionBody = instruction.includes('## User Instruction')
    ? instruction
    : ['## User Instruction', instruction].join('\n');
  return [
    '## User Selected Skills',
    'User explicitly selected these skills. Prioritize these over implicit guessing.',
    ...lines,
    '',
    instructionBody,
  ].join('\n');
}

interface EffectiveInstructionBuildResult {
  instruction: string;
  expertApplied: boolean;
}

function buildInstructionWithSelections(params: {
  instruction: string;
  mentions?: unknown;
  legacySkill?: string;
  expert?: Expert;
}): EffectiveInstructionBuildResult {
  const instructionWithMentions = buildInstructionWithMentionedFiles(
    params.instruction,
    params.mentions
  );
  const instructionWithSkills = buildInstructionWithSelectedSkills(
    instructionWithMentions,
    params.mentions,
    params.legacySkill
  );
  if (!params.expert) {
    return {
      instruction: instructionWithSkills,
      expertApplied: false,
    };
  }

  const expertLines = [
    `- name: ${params.expert.name}`,
    `- role: ${params.expert.role}`,
  ];
  if (Array.isArray(params.expert.expertise) && params.expert.expertise.length > 0) {
    expertLines.push(`- expertise: ${params.expert.expertise.join(', ')}`);
  }
  if (params.expert.promptTemplate?.trim()) {
    expertLines.push(`- instruction: ${params.expert.promptTemplate.trim()}`);
  }

  const instructionBody = instructionWithSkills.includes('## User Instruction')
    ? instructionWithSkills
    : ['## User Instruction', params.instruction].join('\n');

  const finalInstruction = [
    '## User Selected Expert',
    'User explicitly selected this expert. Apply this expert perspective as a high-priority instruction.',
    'If there is a direct conflict, follow the user instruction.',
    ...expertLines,
    '',
    instructionBody,
  ].join('\n');

  return {
    instruction: finalInstruction,
    expertApplied: true,
  };
}

export class TaskAPI {
  private executor: TaskExecutor;
  private skillLoader: SkillLoader;
  private toolRegistry: ToolRegistry;
  private expertManager: ExpertManager;
  private conversationManager: ConversationManager;
  private memoryManager: MemoryManager;
  private tasks: Map<string, TaskListItem> = new Map();
  private currentConversationId: string | null = null;
  /** 与队列分桶键一致：同一会话同时仅一条 execute 路径 */
  private readonly runningConversations = new Set<string>();
  /** 运行中会话 -> AbortController，用于 Esc / API 主动打断 */
  private readonly runningConversationAbortControllers = new Map<string, AbortController>();
  private onCronQueuedComplete?: (taskId: string, success: boolean, result: string) => void;
  private channelQueuedCompleteHandlers: Array<(cmd: QueuedCommand, assistantText: string) => void> = [];

  constructor() {
    this.skillLoader = new SkillLoader();
    this.toolRegistry = new ToolRegistry();
    this.expertManager = new ExpertManager();
    this.conversationManager = new ConversationManager();
    this.memoryManager = new MemoryManager();

    // 注册 Tools
    this.toolRegistry.register(saveMemoryTool);
    this.toolRegistry.register(ReadFileTool);
    this.toolRegistry.register(GlobTool);
    this.toolRegistry.register(GrepTool);
    this.toolRegistry.register(WebFetchTool);
    this.toolRegistry.register(FileEditTool);
    this.toolRegistry.register(WriteFileTool);
    this.toolRegistry.register(BashTool);
    this.toolRegistry.register(PowerShellTool);
    this.toolRegistry.register(WebSearchTool);
    this.toolRegistry.register(CronCreateTool);
    this.toolRegistry.register(CronDeleteTool);
    this.toolRegistry.register(CronListTool);
    this.toolRegistry.register(CronStatusTool);
    this.toolRegistry.register(CronRunsTool);
    this.toolRegistry.register(SkillTool);
    this.toolRegistry.register(SkillHubInstallTool);
    this.toolRegistry.register(BriefTool);
    this.toolRegistry.register(AgentTool);

    this.executor = new TaskExecutor(
      this.skillLoader,
      this.toolRegistry
    );

    // 初始化对话管理器和记忆管理器
    this.conversationManager.init();
    this.memoryManager.init();

    // Fire-and-forget startup sync: overwrite bundled core skills into ~/.squid/skills.
    this.syncBundledCoreSkillsToUserDir().catch((error) => {
      console.warn('[SkillHub] bundled core skills sync skipped:', error?.message || error);
    });

    // Fire-and-forget startup self-healing: ensure local skillhub CLI exists for squid.
    this.ensureSkillHubInstalledForSquid().catch((error) => {
      console.warn('[SkillHub] startup install skipped:', error?.message || error);
    });

    // Fire-and-forget self-healing: restore installed SkillHub files if lock exists.
    this.repairTencentInstalledSkills().catch((error) => {
      console.warn('[SkillHub] repair skipped:', error?.message || error);
    });
  }

  private shouldAutoInstallSkillHubOnStartup(): boolean {
    if (process.env.NODE_ENV === 'test') return false;
    const raw = (process.env.SQUID_AUTO_INSTALL_SKILLHUB || '').trim().toLowerCase();
    if (!raw) return true;
    return !['0', 'false', 'off', 'no'].includes(raw);
  }

  private shouldSyncBundledCoreSkillsOnStartup(): boolean {
    if (process.env.NODE_ENV === 'test') return false;
    const raw = (process.env.SQUID_SYNC_CORE_SKILLS_ON_STARTUP || '').trim().toLowerCase();
    if (!raw) return true;
    return !['0', 'false', 'off', 'no'].includes(raw);
  }

  private async syncBundledCoreSkillsToUserDir(): Promise<void> {
    if (!this.shouldSyncBundledCoreSkillsOnStartup()) return;
    const { existsSync } = await import('fs');
    const { mkdir, cp } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');

    const coreSkills = ['find-skills', 'github', 'skill-creator'];
    const sourceSkillsDir = join(getSquidProjectRoot(), 'skills');
    const targetSkillsDir = join(homedir(), '.squid', 'skills');
    await mkdir(targetSkillsDir, { recursive: true });

    for (const skillName of coreSkills) {
      const sourceDir = join(sourceSkillsDir, skillName);
      if (!existsSync(sourceDir)) {
        console.warn(`[SkillHub] bundled skill not found, skip sync: ${sourceDir}`);
        continue;
      }
      const targetDir = join(targetSkillsDir, skillName);
      if (existsSync(targetDir)) {
        continue;
      }
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }
  }

  private async commandExists(commandName: string): Promise<boolean> {
    const { spawn } = await import('child_process');
    return await new Promise<boolean>((resolve) => {
      const child = spawn('bash', ['-lc', `command -v ${commandName} >/dev/null 2>&1`], {
        stdio: 'ignore',
      });
      child.on('exit', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  private async fileExists(path: string): Promise<boolean> {
    const { access } = await import('fs/promises');
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async hasFindSkillsInstalledForSquid(): Promise<boolean> {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const nestedPath = join(homedir(), '.squid', 'skills', 'find-skills', 'SKILL.md');
    const flatPath = join(homedir(), '.squid', 'skills', 'find-skills.md');
    const [nestedExists, flatExists] = await Promise.all([
      this.fileExists(nestedPath),
      this.fileExists(flatPath),
    ]);
    return nestedExists || flatExists;
  }

  private async hasSkillHubInstalledForSquid(): Promise<boolean> {
    const { homedir } = await import('os');
    const { join } = await import('path');
    const wrapperPath = join(homedir(), '.local', 'bin', 'skillhub');
    const [fromPath, wrapperExists] = await Promise.all([
      this.commandExists('skillhub'),
      this.fileExists(wrapperPath),
    ]);
    return fromPath || wrapperExists;
  }

  private async ensureSkillHubInstalledForSquid(): Promise<void> {
    if (!this.shouldAutoInstallSkillHubOnStartup()) return;
    const [hasSkillHub, hasFindSkills] = await Promise.all([
      this.hasSkillHubInstalledForSquid(),
      this.hasFindSkillsInstalledForSquid(),
    ]);
    if (hasSkillHub && hasFindSkills) return;

    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { spawn } = await import('child_process');
    const squidRoot = getSquidProjectRoot();
    const installerPath = join(squidRoot, 'scripts', 'install-skillhub-for-squid.sh');
    if (!existsSync(installerPath)) {
      throw new Error(`installer script not found: ${installerPath}`);
    }

    const timeoutMs = 180000;
    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      let timedOut = false;
      const child = spawn('bash', [installerPath, '--with-skills'], {
        cwd: squidRoot,
        env: process.env,
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (timedOut) {
          reject(new Error(`skillhub auto-install timeout (${timeoutMs}ms)`));
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `skillhub auto-install failed (exit ${code}): ${truncateText(stderr, 300)}`
            )
          );
          return;
        }
        resolve();
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    const [installedSkillHub, installedFindSkills] = await Promise.all([
      this.hasSkillHubInstalledForSquid(),
      this.hasFindSkillsInstalledForSquid(),
    ]);
    if (!installedSkillHub || !installedFindSkills) {
      throw new Error(
        `skillhub auto-install finished but targets are incomplete (skillhub=${installedSkillHub}, find-skills=${installedFindSkills})`
      );
    }
    console.info('[SkillHub] skillhub + find-skills are auto-installed for squid.');
  }

  private async repairTencentInstalledSkills(): Promise<void> {
    const { access } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');

    const lockfile = await readTencentSkillHubLockfile();
    const entries = Object.entries(lockfile.skills || {});
    if (!entries.length) return;

    const hubConfig = await this.getTencentSkillHubConfig();
    for (const [slug, item] of entries) {
      const nestedPath = join(homedir(), '.squid', 'skills', slug, 'SKILL.md');
      const flatPath = join(homedir(), '.squid', 'skills', `${slug}.md`);
      const exists = await Promise.all([
        access(nestedPath).then(() => true).catch(() => false),
        access(flatPath).then(() => true).catch(() => false),
      ]);
      if (exists[0] || exists[1]) continue;

      const restored = await installTencentSkillHubSkill({
        slug,
        version: item.version || undefined,
        force: true,
        config: hubConfig
      });
      if (!restored.success) {
        console.warn(`[SkillHub] restore failed for ${slug}: ${restored.error || 'unknown'}`);
      }
    }
  }

  /**
   * 为外部 Channel（飞书等）准备持久化会话：先尝试从磁盘加载，否则按固定 ID 创建。
   */
  async prepareExternalConversation(conversationId: string, workspace: string): Promise<void> {
    await this.conversationManager.loadConversation(conversationId);
    if (!this.conversationManager.getConversation(conversationId)) {
      await this.conversationManager.createConversationWithId(conversationId, workspace);
    } else {
      await this.conversationManager.setConversationWorkspace(conversationId, workspace);
    }
  }

  /**
   * 定时任务经队列执行完成后的回调（由 bun 注册，用于日志 / 系统通知）
   */
  setCronQueuedCompletionHandler(
    handler: ((taskId: string, success: boolean, result: string) => void) | undefined
  ): void {
    this.onCronQueuedComplete = handler;
  }

  /**
   * 队列任务流式完成后回调；可多次注册，各渠道在 handler 内判断 `cmd.channelReply?.channelId`。
   * 新增渠道请勿再改 QueuedCommand，应使用 `channelReply` + 本方法注册。
   * @returns 取消注册
   */
  addChannelQueuedCompleteHandler(
    handler: (cmd: QueuedCommand, assistantText: string) => void
  ): () => void {
    this.channelQueuedCompleteHandlers.push(handler);
    return () => {
      const i = this.channelQueuedCompleteHandlers.indexOf(handler);
      if (i >= 0) this.channelQueuedCompleteHandlers.splice(i, 1);
    };
  }

  /** 清空并设为单个 handler（兼容测试/旧代码）；生产环境优先用 addChannelQueuedCompleteHandler */
  setChannelQueuedCompleteHandler(
    handler: ((cmd: QueuedCommand, assistantText: string) => void) | undefined
  ): void {
    this.channelQueuedCompleteHandlers = handler ? [handler] : [];
  }

  resolveConversationIdForQueue(request: TaskRequest): string {
    const fromReq = request.conversationId?.trim();
    if (fromReq) return fromReq;
    if (request.startInNewThread) return buildNewThreadPlaceholderConversationId();
    if (this.currentConversationId) return this.currentConversationId;
    return DEFAULT_CONVERSATION_ID;
  }

  isConversationBusy(conversationId: string): boolean {
    return this.runningConversations.has(conversationId);
  }

  abortConversation(conversationId: string): boolean {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    const controller = this.runningConversationAbortControllers.get(cid);
    if (!controller || controller.signal.aborted) {
      return false;
    }
    controller.abort('user_interrupt');
    return true;
  }

  private static resolveChannelReplyMeta(meta: {
    channelReply?: ChannelQueueReply;
    feishuChatId?: string;
  }): ChannelQueueReply | undefined {
    const id = meta.channelReply?.channelId?.trim();
    const chat = meta.channelReply?.chatId?.trim();
    if (id && chat) {
      return { channelId: id, chatId: chat };
    }
    const legacy = meta.feishuChatId?.trim();
    if (legacy) {
      return { channelId: 'feishu', chatId: legacy };
    }
    return undefined;
  }

  /**
   * 将请求排入会话队列，返回入队后的队列深度（含本条）
   */
  enqueueFromRequest(
    request: TaskRequest,
    meta: {
      source: QueuedCommandSource;
      taskId?: string;
      isMeta?: boolean;
      priority?: QueuePriority;
      channelReply?: ChannelQueueReply;
      /** @deprecated 请改用 channelReply: { channelId: 'feishu', chatId } */
      feishuChatId?: string;
    }
  ): number {
    const cid = this.resolveConversationIdForQueue(request);
    const normalizedAttachments = normalizeImageAttachments(request.attachments);
    const channelReply = TaskAPI.resolveChannelReplyMeta(meta);
    const cmd: QueuedCommand = {
      conversationId: cid,
      value: request.instruction,
      mode: request.mode,
      workspace: request.workspace,
      startInNewThread: request.startInNewThread === true,
      expertId: request.expertId,
      skill: request.skill,
      mentions: normalizeMentions(request.mentions),
      attachments: normalizedAttachments.ok ? normalizedAttachments.attachments : [],
      source: meta.source,
      taskId: meta.taskId,
      isMeta: meta.isMeta,
      priority: meta.priority,
      channelReply,
    };
    const useLater = meta.priority === 'later' || meta.source === 'cron';
    if (useLater) {
      enqueuePendingNotification(cmd);
    } else {
      enqueue(cmd);
    }
    const len = getConversationQueueLength(cid);
    this.scheduleDrain(cid);
    return len;
  }

  /** 非 enqueueFromRequest 路径入队后调用（如 cron 直接写 messageQueueManager） */
  kickConversationQueueDrain(conversationId: string): void {
    this.scheduleDrain(conversationId);
  }

  /** 队列处理器调用：从 QueuedCommand 走流式执行（内部仍会占会话锁） */
  async runFromQueue(cmd: QueuedCommand): Promise<void> {
    let w = cmd.workspace?.trim();
    if (!w) {
      try {
        const ws = await this.getWorkspaceConfig();
        w = ws.workspace?.trim() || process.cwd();
      } catch {
        w = process.cwd();
      }
    }
    const workspace = w ?? process.cwd();
    let streamedAssistant = '';
    try {
      if (cmd.source === 'cron') {
        await this.prepareExternalConversation(cmd.conversationId, workspace);
      }
      await this.executeTaskStream(
        {
          mode: cmd.mode ?? 'ask',
          workspace,
          instruction: cmd.value,
          conversationId: cmd.conversationId,
          startInNewThread: cmd.startInNewThread,
          expertId: cmd.expertId,
          skill: cmd.skill,
          mentions: cmd.mentions,
          attachments: cmd.attachments,
        },
        (chunk) => {
          streamedAssistant += chunk;
        }
      );
      if (
        cmd.channelReply?.channelId?.trim() &&
        cmd.channelReply.chatId?.trim() &&
        this.channelQueuedCompleteHandlers.length > 0
      ) {
        for (const h of this.channelQueuedCompleteHandlers) {
          try {
            h(cmd, streamedAssistant);
          } catch (cbErr) {
            console.error('[TaskAPI] channelQueuedCompleteHandler failed', cbErr);
          }
        }
      }
      if (cmd.source === 'cron' && cmd.taskId && this.onCronQueuedComplete) {
        this.onCronQueuedComplete(cmd.taskId, true, '任务执行完成');
      }
    } catch (e) {
      if (cmd.source === 'cron' && cmd.taskId && this.onCronQueuedComplete) {
        const msg = e instanceof Error ? e.message : String(e);
        this.onCronQueuedComplete(cmd.taskId, false, msg);
      }
      throw e;
    }
  }

  private scheduleDrain(conversationId: string): void {
    void import('../utils/queueProcessor')
      .then(({ processConversationQueueIfReady }) =>
        processConversationQueueIfReady(this, conversationId)
      )
      .catch((err) => console.error('[TaskAPI] scheduleDrain failed', err));
  }

  async listTasks(): Promise<TaskListItem[]> {
    return Array.from(this.tasks.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async listSkills(workspace?: string): Promise<Array<{ name: string; description: string; effort: string }>> {
    const workspacePath = (workspace || '').trim();
    const skills = await this.skillLoader.loadAll(workspacePath || undefined);
    return Array.from(skills.values()).map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      effort: skill.metadata.effort || 'medium'
    }));
  }

  async generateSkill(description: string): Promise<{ success: boolean; yaml?: string; error?: string }> {
    try {
      // TODO: Generate skill YAML via LLM.
      // Temporary template response.
      const yaml = `---
name: custom-skill
description: ${description}
when-to-use: Use according to user intent
allowed-tools:
  - Read
  - Write
  - Bash
effort: medium
user-invocable: true
---

You are a professional assistant focused on: ${description}

Complete tasks based on the user's instructions.`;

      return {
        success: true,
        yaml
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async saveSkill(yaml: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const skillsDir = join(homedir(), '.squid', 'skills');
      await mkdir(skillsDir, { recursive: true });

      // 从 YAML 中提取技能名称
      const nameMatch = yaml.match(/name:\s*(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : 'custom-skill';

      const filePath = join(skillsDir, `${name}.md`);
      await writeFile(filePath, yaml, 'utf-8');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async previewSkill(url: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      let content: string;

      // 判断是 URL 还是本地路径
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // 从远程获取
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        content = await response.text();
      } else {
        // 从本地读取
        const { readFile } = await import('fs/promises');
        content = await readFile(url, 'utf-8');
      }

      // 解析技能文件
      const parts = content.split('---\n');
      if (parts.length < 3) {
        throw new Error('Invalid skill file format');
      }

      const yamlContent = parts[1];
      const lines = yamlContent.split('\n');
      const metadata: any = {};
      let currentKey = '';
      let currentArray: string[] = [];

      for (const line of lines) {
        if (line.includes(':')) {
          if (currentKey && currentArray.length > 0) {
            metadata[currentKey] = currentArray;
            currentArray = [];
          }
          const [key, value] = line.split(':').map(s => s.trim());
          currentKey = key;
          if (value) {
            metadata[key] = value === 'true' ? true : value === 'false' ? false : value;
          }
        } else if (line.trim().startsWith('-')) {
          currentArray.push(line.trim().substring(1).trim());
        }
      }

      if (currentKey && currentArray.length > 0) {
        metadata[currentKey] = currentArray;
      }

      return {
        success: true,
        data: {
          name: metadata.name || 'unknown',
          description: metadata.description || '',
          allowedTools: metadata['allowed-tools'] || [],
          hooks: metadata.hooks || {},
          content
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async installSkill(data: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const skillsDir = join(homedir(), '.squid', 'skills');
      await mkdir(skillsDir, { recursive: true });

      const filePath = join(skillsDir, `${data.name}.md`);
      await writeFile(filePath, data.content, 'utf-8');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async getTencentSkillHubConfig(): Promise<{
    baseUrl: string;
    token?: string;
    indexUrl?: string;
    searchUrl?: string;
    primaryDownloadUrlTemplate?: string;
    fallbackDownloadUrlTemplate?: string;
  }> {
    const config = await this.getModelConfig();
    const skillHubConfig = (config?.skillhub?.tencent || config?.tencentSkillHub || {}) as any;
    const defaultBaseUrl = 'https://lightmake.site/api/v1';
    const defaultIndexUrl = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json';
    const defaultSearchUrl = 'https://lightmake.site/api/v1/search';
    const defaultPrimaryDownloadTemplate = 'https://lightmake.site/api/v1/download?slug={slug}';
    const defaultFallbackDownloadTemplate = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/{slug}.zip';
    return {
      baseUrl: skillHubConfig.baseUrl || process.env.TENCENT_SKILLHUB_BASE_URL || defaultBaseUrl,
      token: skillHubConfig.token || process.env.TENCENT_SKILLHUB_TOKEN || undefined,
      indexUrl: skillHubConfig.indexUrl || process.env.TENCENT_SKILLHUB_INDEX_URL || defaultIndexUrl,
      searchUrl: skillHubConfig.searchUrl || process.env.TENCENT_SKILLHUB_SEARCH_URL || defaultSearchUrl,
      primaryDownloadUrlTemplate:
        skillHubConfig.primaryDownloadUrlTemplate ||
        process.env.TENCENT_SKILLHUB_PRIMARY_DOWNLOAD_URL_TEMPLATE ||
        defaultPrimaryDownloadTemplate,
      fallbackDownloadUrlTemplate:
        skillHubConfig.fallbackDownloadUrlTemplate ||
        process.env.TENCENT_SKILLHUB_FALLBACK_DOWNLOAD_URL_TEMPLATE ||
        defaultFallbackDownloadTemplate,
    };
  }

  async listTencentSkillHubSkills(query?: string, limit: number = 20): Promise<TencentSkillHubCatalogResponse> {
    try {
      const hubConfig = await this.getTencentSkillHubConfig();
      const client = new TencentSkillHubClient(hubConfig);
      const lockfile = await readTencentSkillHubLockfile();
      const skills = await client.listSkills({ query, limit });
      const catalog = skills.map(skill => {
        const { status, installedVersion } = getTencentSkillHubInstallStatus({
          lockfile,
          slug: skill.slug,
          latestVersion: skill.latestVersion
        });
        return {
          ...skill,
          installStatus: status,
          installedVersion
        };
      });
      return {
        success: true,
        skills: catalog,
        total: catalog.length
      };
    } catch (error: any) {
      const rawMessage = error?.message || String(error);
      const message = rawMessage.includes('SkillHub 返回了 HTML 页面')
        ? rawMessage
        : `腾讯 SkillHub 加载失败：${rawMessage}`;
      return {
        success: false,
        skills: [],
        total: 0,
        error: message
      };
    }
  }

  async installTencentSkillHubSkill(
    params: { slug: string; version?: string; force?: boolean }
  ): Promise<TencentSkillHubInstallResult> {
    const hubConfig = await this.getTencentSkillHubConfig();
    return await installTencentSkillHubSkill({
      slug: params.slug,
      version: params.version,
      force: params.force,
      config: hubConfig
    });
  }

  async listTencentInstalledSkills(): Promise<{
    success: boolean;
    skills: Array<{ slug: string; version: string; installedAt: number; name?: string; description?: string }>;
    error?: string;
  }> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const lockfile = await readTencentSkillHubLockfile();
      const skills = await Promise.all(
        Object.entries(lockfile.skills || {}).map(async ([slug, item]) => {
          const skillPath = join(homedir(), '.squid', 'skills', slug, 'SKILL.md');
          let name = slug;
          let description = '';
          try {
            const content = await readFile(skillPath, 'utf-8');
            name = content.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim() || slug;
            description = content.match(/^\s*description:\s*(.+)$/m)?.[1]?.trim() || '';
          } catch {
            // fallback to slug when local skill content missing
          }
          return {
            slug,
            version: item.version || '',
            installedAt: Number(item.installedAt || 0),
            name,
            description,
          };
        })
      );
      skills.sort((a, b) => b.installedAt - a.installedAt);
      return { success: true, skills };
    } catch (error: any) {
      return {
        success: false,
        skills: [],
        error: error?.message || String(error),
      };
    }
  }

  async getTencentInstalledSkillDetail(slug: string): Promise<{
    success: boolean;
    skill?: {
      slug: string;
      version?: string;
      installedAt?: number;
      content?: string;
      title?: string;
      description?: string;
    };
    error?: string;
  }> {
    const normalized = String(slug || '').trim().toLowerCase();
    if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) {
      return { success: false, error: `Invalid slug: ${slug}` };
    }
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const skillPath = join(homedir(), '.squid', 'skills', normalized, 'SKILL.md');
      const content = await readFile(skillPath, 'utf-8');
      const lockfile = await readTencentSkillHubLockfile();
      const meta = lockfile.skills?.[normalized];
      const title = content.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim() || normalized;
      const description = content.match(/^\s*description:\s*(.+)$/m)?.[1]?.trim() || '';
      return {
        success: true,
        skill: {
          slug: normalized,
          version: meta?.version,
          installedAt: meta?.installedAt,
          content,
          title,
          description,
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  async uninstallTencentInstalledSkill(slug: string): Promise<{
    success: boolean;
    slug: string;
    error?: string;
  }> {
    const normalized = String(slug || '').trim().toLowerCase();
    if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) {
      return { success: false, slug: normalized || slug, error: `Invalid slug: ${slug}` };
    }
    try {
      const { rm } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const skillDir = join(homedir(), '.squid', 'skills', normalized);
      const flatSkillFile = join(homedir(), '.squid', 'skills', `${normalized}.md`);
      await rm(skillDir, { recursive: true, force: true });
      await rm(flatSkillFile, { force: true });

      const lockfile = await readTencentSkillHubLockfile();
      if (lockfile.skills?.[normalized]) {
        delete lockfile.skills[normalized];
        const { writeTencentSkillHubLockfile } = await import('../skills/tencent-skillhub-metadata');
        await writeTencentSkillHubLockfile(lockfile);
      }

      const originPath = join(homedir(), '.squid', 'skillhub', 'tencent', 'origins', `${normalized}.json`);
      await rm(originPath, { force: true });

      return { success: true, slug: normalized };
    } catch (error: any) {
      return {
        success: false,
        slug: normalized,
        error: error?.message || String(error),
      };
    }
  }

  async executeTask(request: TaskRequest): Promise<TaskResponse> {
    const normalizedAttachmentResult = normalizeImageAttachments(request.attachments);
    if (!normalizedAttachmentResult.ok) {
      return {
        success: false,
        error: normalizedAttachmentResult.error,
      };
    }
    const cid = this.resolveConversationIdForQueue(request);
    if (this.runningConversations.has(cid)) {
      const pos = this.enqueueFromRequest(request, { source: 'user', priority: 'next' });
      return {
        success: true,
        queued: true,
        queuePosition: pos,
        conversationId: cid,
      };
    }
    this.runningConversations.add(cid);
    try {
      try {
        console.log(
          '[LLM] Task request | userPrompt=%s | workspace=%s mode=%s',
          truncateMiddleText(request.instruction || '', 200),
          request.workspace,
          request.mode
        );
        appendAgentLog('task', 'info', 'executeTask started', {
          mode: request.mode,
          workspace: request.workspace,
          instructionPreview: truncateText(request.instruction, 240),
          fileMentionsCount: splitMentions(normalizeMentions(request.mentions)).fileMentions.length,
          skillMentionsCount: splitMentions(normalizeMentions(request.mentions)).skillMentions.length,
          startInNewThread: request.startInNewThread === true,
          expertId: request.expertId || undefined,
        });

        const taskId = Date.now().toString();

        this.tasks.set(taskId, {
          id: taskId,
          instruction: request.instruction,
          mode: request.mode,
          status: 'running',
          createdAt: new Date().toISOString(),
          workspace: request.workspace,
          expertId: request.expertId,
        });

        const sandbox = new WorkspaceSandbox(request.workspace);
        await sandbox.validatePath(request.workspace);
        const normalizedMentions = normalizeMentions(request.mentions);
        const mentionValidation = await validateMentionsForWorkspaceAndSkills(
          request.workspace,
          normalizedMentions,
          this.skillLoader,
          request.workspace
        );
        if (!mentionValidation.ok) {
          return {
            success: false,
            error: mentionValidation.error,
          };
        }
        const mentionImageAttachmentsResult = await resolveImageAttachmentsFromMentionedFiles(
          request.workspace,
          mentionValidation.mentions
        );
        if (!mentionImageAttachmentsResult.ok) {
          return {
            success: false,
            error: mentionImageAttachmentsResult.error,
          };
        }
        const mergedAttachments = mergeImageAttachments(
          normalizedAttachmentResult.attachments,
          mentionImageAttachmentsResult.attachments
        );
        const expert = request.expertId ? this.expertManager.get(request.expertId) : undefined;
        const selectedSkillsForLog = mergeSelectedSkillsForLog(mentionValidation.mentions, request.skill);
        appendAgentLog('task', 'info', 'Selection summary', {
          selectedSkillsCount: selectedSkillsForLog.length,
          selectedSkills: summarizeNameList(selectedSkillsForLog),
          fileMentionsCount: splitMentions(mentionValidation.mentions).fileMentions.length,
        });
        console.log(
          '[LLM] Selection summary | selectedSkills(%d)=%s',
          selectedSkillsForLog.length,
          summarizeNameList(selectedSkillsForLog)
        );
        const effective = buildInstructionWithSelections({
          instruction: request.instruction,
          mentions: mentionValidation.mentions,
          legacySkill: request.skill,
          expert,
        });
        const effectiveInstruction = effective.instruction;
        appendAgentLog('task', 'debug', 'executeTask instruction built', {
          expertId: request.expertId || undefined,
          expertApplied: effective.expertApplied,
          fileMentionsCount: splitMentions(mentionValidation.mentions).fileMentions.length,
          skillMentionsCount: splitMentions(mentionValidation.mentions).skillMentions.length,
          instructionPreview: truncateText(effectiveInstruction, 240),
        });

        const planConversationId =
          normalizeSyntheticConversationId(cid);
        const result = await this.executor.execute({
          mode: request.mode,
          instruction: effectiveInstruction,
          workspace: request.workspace,
          conversationId: planConversationId,
          attachments: mergedAttachments,
        });

        const task = this.tasks.get(taskId);
        if (task) {
          task.status = result.error ? 'failed' : 'completed';
        }

        if (result.error) {
          appendAgentLog('task', 'error', 'executeTask failed', {
            error: truncateText(result.error, 500),
          });
          return {
            success: false,
            error: result.error,
            output: result.output,
            files: result.files || [],
          };
        }

        appendAgentLog('task', 'info', 'executeTask completed', {
          outputChars: (result.output || '').length,
        });
        return {
          success: true,
          output: result.output,
          files: result.files || [],
        };
      } catch (error: any) {
        console.error('Task execution failed:', error);
        appendAgentLog('task', 'error', 'executeTask exception', {
          error: truncateText(error?.message || String(error), 500),
        });

        const taskId = Array.from(this.tasks.values()).find((t) => t.status === 'running')?.id;
        if (taskId) {
          const task = this.tasks.get(taskId);
          if (task) {
            task.status = 'failed';
          }
        }

        return {
          success: false,
          error: error.message || 'Unknown error',
        };
      }
    } finally {
      this.runningConversations.delete(cid);
      this.scheduleDrain(cid);
    }
  }

  async executeTaskStream(request: TaskRequest, onChunk: (chunk: string) => void): Promise<void> {
    const normalizedAttachmentResult = normalizeImageAttachments(request.attachments);
    if (!normalizedAttachmentResult.ok) {
      throw new Error(normalizedAttachmentResult.error);
    }
    const cid = this.resolveConversationIdForQueue(request);
    const command = (request.instruction || '').trim();
    if (/^\/wtf\b/i.test(command)) {
      const aborted = this.abortConversation(cid);
      appendAgentLog('task-stream', 'info', 'execute /wtf (abort current run)', {
        conversationId: cid,
        aborted,
      });
      onChunk(aborted ? '⛔ 已中断当前生成。' : 'ℹ️ 当前没有可中断的运行任务。');
      return;
    }
    if (this.runningConversations.has(cid)) {
      throw new TaskAPIConversationBusyError(cid);
    }
    this.runningConversations.add(cid);
    const runAbortController = new AbortController();
    this.runningConversationAbortControllers.set(cid, runAbortController);
    const normalizedRequest = {
      ...request,
      attachments: normalizedAttachmentResult.attachments,
      conversationId: normalizeSyntheticConversationId(request.conversationId),
    };
    try {
      try {
        const trimmedInstruction = (normalizedRequest.instruction || '').trim();

        const shouldForceNewConversation =
          normalizedRequest.startInNewThread === true &&
          !normalizedRequest.conversationId;

        let conversationId = shouldForceNewConversation
          ? undefined
          : (normalizedRequest.conversationId || this.currentConversationId);
        if (!conversationId) {
          conversationId = await this.conversationManager.createConversation(normalizedRequest.workspace);
          this.currentConversationId = conversationId;
        } else if (normalizedRequest.workspace) {
          await this.conversationManager.setConversationWorkspace(conversationId, normalizedRequest.workspace);
        }

        // 与 Web `/reset`、`/new` 对齐：任意走 executeTaskStream 的渠道（飞书/Telegram/队列/HTTP）共用，不经 LLM
        // /new = 仅清空当前线程消息；/reset = 清空会话并清空全部长期记忆
        if (/^\/new\b/i.test(trimmedInstruction)) {
          const r = await this.clearThreadMessages(conversationId);
          appendAgentLog('task-stream', 'info', 'execute /new (no LLM, session messages only)', {
            success: r.success,
            conversationId,
          });
          onChunk(
            r.success
              ? '✅ 已清空当前会话。'
              : `❌ 清空会话失败：${r.error ?? '未知错误'}`
          );
          return;
        }
        if (/^\/reset\b/i.test(trimmedInstruction)) {
          const r = await this.newSessionClearAll(conversationId);
          appendAgentLog('task-stream', 'info', 'execute /reset (no LLM, session + memory)', {
            success: r.success,
            conversationId,
          });
          onChunk(
            r.success
              ? '✅ 已清空当前会话与全部长期记忆。'
              : `❌ ${r.error ?? '操作失败'}`
          );
          return;
        }

        const normalizedMentions = normalizeMentions(normalizedRequest.mentions);
        const mentionValidation = await validateMentionsForWorkspaceAndSkills(
          normalizedRequest.workspace,
          normalizedMentions,
          this.skillLoader,
          normalizedRequest.workspace
        );
        if (!mentionValidation.ok) {
          throw new Error(mentionValidation.error);
        }
        const mentionImageAttachmentsResult = await resolveImageAttachmentsFromMentionedFiles(
          normalizedRequest.workspace,
          mentionValidation.mentions
        );
        if (!mentionImageAttachmentsResult.ok) {
          throw new Error(mentionImageAttachmentsResult.error);
        }
        const mergedAttachments = mergeImageAttachments(
          normalizedAttachmentResult.attachments,
          mentionImageAttachmentsResult.attachments
        );

        const expert = normalizedRequest.expertId
          ? this.expertManager.get(normalizedRequest.expertId)
          : undefined;
        const selectedSkillsForLog = mergeSelectedSkillsForLog(
          mentionValidation.mentions,
          normalizedRequest.skill
        );
        appendAgentLog('task-stream', 'info', 'Selection summary', {
          selectedSkillsCount: selectedSkillsForLog.length,
          selectedSkills: summarizeNameList(selectedSkillsForLog),
          fileMentionsCount: splitMentions(mentionValidation.mentions).fileMentions.length,
        });
        console.log(
          '[LLM] Selection summary | selectedSkills(%d)=%s',
          selectedSkillsForLog.length,
          summarizeNameList(selectedSkillsForLog)
        );
        const effective = buildInstructionWithSelections({
          instruction: normalizedRequest.instruction,
          mentions: mentionValidation.mentions,
          legacySkill: normalizedRequest.skill,
          expert,
        });
        const effectiveInstruction = effective.instruction;
        const modelConfig = await this.getModelConfig();
        const apiKey = (modelConfig.apiKey || '').trim();
        const baseURL = normalizedRequest.baseURL || modelConfig.apiEndpoint;
        const modelName = normalizedRequest.modelName || modelConfig.modelName;

        console.log(
          '[LLM] TaskAPI.executeTaskStream start workspace=%s conversationId=%s model.provider=%s apiKeyConfigured=%s',
          normalizedRequest.workspace,
          normalizedRequest.conversationId || '(默认会话)',
          modelConfig.provider || '(无)',
          apiKey ? 'yes' : 'no'
        );

        const streamStartedAt = Date.now();
        appendAgentLog('task-stream', 'info', 'executeTaskStream -> LLM', {
          workspace: normalizedRequest.workspace,
          conversationId,
          mode: normalizedRequest.mode,
          provider: modelConfig.provider || '',
          instructionPreview: truncateText(normalizedRequest.instruction, 240),
          startInNewThread: normalizedRequest.startInNewThread === true,
          fileMentionsCount: splitMentions(mentionValidation.mentions).fileMentions.length,
          skillMentionsCount: splitMentions(mentionValidation.mentions).skillMentions.length,
          expertId: normalizedRequest.expertId || undefined,
          expertApplied: effective.expertApplied,
          effectiveInstructionPreview: truncateText(effectiveInstruction, 240),
          imageAttachmentsCount: mergedAttachments.length,
        });

        if (apiKey) {
          this.conversationManager.setApiKey(apiKey, baseURL, modelName);
        }

        // 仅传入「本轮之前」的持久化历史；本轮 user 由 executor 拼进请求。模型返回成功后再写入 user + assistant。
        const conversationHistory = this.conversationManager.getMessages(conversationId);

        const taskId = Date.now().toString();

        this.tasks.set(taskId, {
          id: taskId,
          instruction: normalizedRequest.instruction,
          mode: normalizedRequest.mode,
          status: 'running',
          createdAt: new Date().toISOString(),
          workspace: normalizedRequest.workspace,
          expertId: normalizedRequest.expertId,
        });

        console.log('[LLM] TaskAPI validating workspace: %s', normalizedRequest.workspace);
        const sandbox = new WorkspaceSandbox(normalizedRequest.workspace);
        await sandbox.validatePath(normalizedRequest.workspace);

        let fullResponse = '';

        console.log('[LLM] TaskAPI -> TaskExecutor.executeStream (model credentials loaded only from ~/.squid/config.json)');

        const executorConversationId =
          normalizeSyntheticConversationId(conversationId);
        await this.executor.executeStream(
          {
            mode: normalizedRequest.mode,
            instruction: effectiveInstruction,
            workspace: normalizedRequest.workspace,
            conversationHistory,
            conversationId: executorConversationId,
            attachments: mergedAttachments,
            abortSignal: runAbortController.signal,
          },
          (chunk: string) => {
            fullResponse += chunk;
            onChunk(chunk);
          }
        );

        await this.conversationManager.addMessage(conversationId, 'user', normalizedRequest.instruction);
        await this.conversationManager.addMessage(conversationId, 'assistant', fullResponse);

        const task = this.tasks.get(taskId);
        if (task) {
          task.status = 'completed';
        }
        appendAgentLog('task-stream', 'info', 'executeTaskStream completed', {
          durationMs: Date.now() - streamStartedAt,
          responseChars: fullResponse.length,
          conversationId,
        });
      } catch (error: any) {
        if (isAbortError(error)) {
          appendAgentLog('task-stream', 'info', 'executeTaskStream aborted', {
            conversationId: cid,
          });
          onChunk('⛔ 已中断当前生成。');
          return;
        }
        console.error('Task execution failed:', error);
        appendAgentLog('task-stream', 'error', 'executeTaskStream failed', {
          error: truncateText(error?.message || String(error), 500),
        });

        const taskId = Array.from(this.tasks.values()).find((t) => t.status === 'running')?.id;
        if (taskId) {
          const task = this.tasks.get(taskId);
          if (task) {
            task.status = 'failed';
          }
        }

        throw error;
      }
    } finally {
      this.runningConversations.delete(cid);
      this.runningConversationAbortControllers.delete(cid);
      this.scheduleDrain(cid);
    }
  }

  async listExperts() {
    return this.expertManager.list();
  }

  async getExpert(id: string) {
    return this.expertManager.get(id);
  }

  async switchExpert(taskId: string, expertId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const task = this.tasks.get(taskId);
      if (!task) {
        return {
          success: false,
          error: 'Task not found'
        };
      }

      // 更新任务的专家
      task.expertId = expertId;

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async createCustomExpert(data: {
    name: string;
    role: string;
    expertise: string[];
    promptTemplate: string;
  }): Promise<{ success: boolean; expert?: any; error?: string }> {
    try {
      const expert = {
        id: `custom-${Date.now()}`,
        name: data.name,
        role: data.role,
        expertise: data.expertise,
        promptTemplate: data.promptTemplate
      };

      await this.expertManager.addCustomExpert(expert);

      return {
        success: true,
        expert
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async clearConversation(): Promise<{ success: boolean }> {
    try {
      if (this.currentConversationId) {
        this.conversationManager.clearConversation(this.currentConversationId);
      }
      // 创建新对话
      this.currentConversationId = null;
      return { success: true };
    } catch (error: any) {
      return { success: false };
    }
  }

  async getConversationHistory(): Promise<any[]> {
    try {
      if (this.currentConversationId) {
        return this.conversationManager.getMessages(this.currentConversationId);
      }
      return [];
    } catch (error: any) {
      return [];
    }
  }

  async startNewThread(): Promise<{ success: boolean }> {
    this.currentConversationId = null;
    return { success: true };
  }

  /**
   * 清空指定线程（或当前线程）的持久化消息；无 threadId 且无当前会话时仅清空宿主 currentConversationId。
   * 会先从磁盘 load 再清，避免仅内存无图时 clear 空操作。
   */
  async clearThreadMessages(threadId?: string): Promise<{
    success: boolean;
    threadId?: string | null;
    error?: string;
  }> {
    const id = String(threadId || this.currentConversationId || '').trim();
    if (!id) {
      this.currentConversationId = null;
      return { success: true, threadId: null };
    }
    try {
      let conv = this.conversationManager.getConversation(id);
      if (!conv) {
        conv = await this.conversationManager.loadConversation(id);
      }
      if (!conv) {
        if (this.currentConversationId === id) {
          this.currentConversationId = null;
        }
        return { success: true, threadId: null };
      }
      await this.conversationManager.clearConversation(id);
      this.currentConversationId = id;
      return { success: true, threadId: id };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  /**
   * 与聊天框 `/reset` 对应：清空当前（或指定）线程消息，并清空全部长期记忆文件。
   */
  async newSessionClearAll(threadId?: string): Promise<{
    success: boolean;
    threadId?: string | null;
    error?: string;
  }> {
    const convResult = await this.clearThreadMessages(threadId);
    if (!convResult.success) {
      return convResult;
    }
    try {
      await this.memoryManager.clearAllMemories();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        threadId: convResult.threadId,
        error: `会话已清空，记忆清空失败: ${msg}`,
      };
    }
    return { success: true, threadId: convResult.threadId };
  }

  async listThreads(): Promise<{ success: boolean; threads: ThreadListItem[]; error?: string }> {
    try {
      const conversations = await this.conversationManager.listConversations();
      const threads = conversations
        .map((conversation) => {
          const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
          const preview =
            conversation.messages.length === 0
              ? '（空会话）'
              : firstUserMessage?.content?.trim() || '新线程';
          const shortPreview = preview.length > 80 ? `${preview.slice(0, 80)}...` : preview;
          return {
            id: conversation.id,
            title: shortPreview || '新线程',
            preview: shortPreview || '新线程',
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.messages.length,
            workspace: conversation.workspace,
          } satisfies ThreadListItem;
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return { success: true, threads };
    } catch (error: any) {
      return {
        success: false,
        threads: [],
        error: error?.message || String(error),
      };
    }
  }

  async switchThread(threadId: string): Promise<{
    success: boolean;
    threadId?: string;
    messages?: ConversationMessage[];
    workspace?: string;
    error?: string;
  }> {
    const id = String(threadId || '').trim();
    if (!id) {
      return { success: false, error: 'threadId is required' };
    }

    try {
      let conversation = this.conversationManager.getConversation(id);
      if (!conversation) {
        conversation = await this.conversationManager.loadConversation(id);
      }
      const messages = conversation?.messages || [];

      this.currentConversationId = id;
      return {
        success: true,
        threadId: id,
        messages,
        workspace: conversation?.workspace,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  async deleteThread(threadId: string): Promise<{ success: boolean; threadId?: string; error?: string }> {
    const id = String(threadId || '').trim();
    if (!id) {
      return { success: false, error: 'threadId is required' };
    }

    try {
      const deleted = await this.conversationManager.deleteConversation(id);
      if (!deleted) {
        return { success: false, error: `删除线程失败: ${id}` };
      }

      if (this.currentConversationId === id) {
        this.currentConversationId = null;
      }

      return { success: true, threadId: id };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  async generateExpertFromDescription(description: string): Promise<{ success: boolean; expert?: any; error?: string }> {
    try {
      // TODO: Generate expert profile via LLM.
      // Temporary template response.
      const expert = {
        name: 'Custom Expert',
        role: description,
        expertise: ['General Skills'],
        promptTemplate: `You are a professional assistant focused on: ${description}\n\nProvide expert help based on user needs.`
      };

      return {
        success: true,
        expert
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getModelConfig(): Promise<any> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configPath = join(homedir(), '.squid', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return config.model || {};
    } catch (error: any) {
      return {};
    }
  }

  async saveModelConfig(config: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { mkdir, readFile, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configDir = join(homedir(), '.squid');
      await mkdir(configDir, { recursive: true });

      const configPath = join(configDir, 'config.json');

      let existingConfig: any = {};
      try {
        const content = await readFile(configPath, 'utf-8');
        existingConfig = JSON.parse(content);
      } catch {
        // File doesn't exist, use empty config
      }

      existingConfig.model = config;
      await writeFile(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async testModelConfig(config: any): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      // 根据不同的提供商测试连接
      if (config.provider === 'openai') {
        const response = await fetch(config.apiEndpoint || 'https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return {
          success: true,
          message: 'OpenAI API connected successfully'
        };
      } else if (config.provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: config.modelName || 'claude-3-5-sonnet-20241022',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'test' }]
          })
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`HTTP ${response.status}: ${error}`);
        }

        return {
          success: true,
          message: 'Anthropic API connected successfully'
        };
      } else if (config.provider === 'custom') {
        // Custom endpoint, test by protocol type
        if (config.apiProtocol === 'openai') {
          const response = await fetch(`${config.apiEndpoint}/models`, {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`
            }
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return {
            success: true,
            message: 'Custom endpoint (OpenAI protocol) connected successfully'
          };
        } else if (config.apiProtocol === 'anthropic') {
          const response = await fetch(`${config.apiEndpoint}/messages`, {
            method: 'POST',
            headers: {
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: config.modelName || 'claude-3-5-sonnet-20241022',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'test' }]
            })
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(`HTTP ${response.status}: ${error}`);
          }

          return {
            success: true,
            message: 'Custom endpoint (Anthropic protocol) connected successfully'
          };
        }
      }

      return {
        success: false,
        error: 'Unknown provider type'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getWorkspaceConfig(): Promise<any> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configPath = join(homedir(), '.squid', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      return { workspace: config.workspace || '/tmp/squid-test' };
    } catch (error: any) {
      return { workspace: '/tmp/squid-test' };
    }
  }

  async saveWorkspaceConfig(config: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { mkdir, readFile, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configDir = join(homedir(), '.squid');
      await mkdir(configDir, { recursive: true });

      const configPath = join(configDir, 'config.json');

      let existingConfig: any = {};
      try {
        const content = await readFile(configPath, 'utf-8');
        existingConfig = JSON.parse(content);
      } catch {
        // File doesn't exist, use empty config
      }

      existingConfig.workspace = config.workspace;
      await writeFile(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /** 联网搜索：config.json → tools.webSearch.provider（与大模型无关） */
  async getWebSearchConfig(): Promise<{ webSearchProvider: 'duckduckgo' | 'bing' }> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configPath = join(homedir(), '.squid', 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const root = JSON.parse(content) as Record<string, unknown>;
      const raw = readWebSearchProviderRawFromSquidConfigRoot(root);
      return { webSearchProvider: normalizeWebSearchProvider(raw) };
    } catch {
      return { webSearchProvider: 'duckduckgo' };
    }
  }

  async saveWebSearchConfig(body: {
    webSearchProvider?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { mkdir, readFile, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const configDir = join(homedir(), '.squid');
      await mkdir(configDir, { recursive: true });

      const configPath = join(configDir, 'config.json');

      let existingConfig: Record<string, unknown> = {};
      try {
        const content = await readFile(configPath, 'utf-8');
        existingConfig = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // File doesn't exist
      }

      const provider = normalizeWebSearchProvider(body.webSearchProvider);
      setWebSearchProviderInSquidConfig(existingConfig, provider);

      await writeFile(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async pickDirectory(): Promise<{
    success: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
  }> {
    try {
      const { platform } = await import('os');
      const { spawnSync } = await import('child_process');

      const currentPlatform = platform();
      if (currentPlatform === 'darwin') {
        const result = spawnSync(
          'osascript',
          ['-e', 'POSIX path of (choose folder with prompt "请选择工作目录")'],
          { encoding: 'utf-8' }
        );

        if (result.status === 0) {
          const pickedPath = (result.stdout || '').trim();
          if (pickedPath) {
            return { success: true, path: pickedPath };
          }
        }

        const errorText = `${result.stderr || ''} ${result.stdout || ''}`;
        if (errorText.includes('-128')) {
          return { success: false, cancelled: true };
        }
        return { success: false, error: (result.stderr || '目录选择失败').trim() };
      }

      if (currentPlatform === 'win32') {
        const result = spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
          ],
          { encoding: 'utf-8' }
        );

        if (result.status === 0) {
          const pickedPath = (result.stdout || '').trim();
          if (pickedPath) {
            return { success: true, path: pickedPath };
          }
          return { success: false, cancelled: true };
        }
        return { success: false, error: (result.stderr || '目录选择失败').trim() };
      }

      // Linux fallback: try zenity first, then kdialog.
      const result = spawnSync(
        'bash',
        ['-lc', 'if command -v zenity >/dev/null 2>&1; then zenity --file-selection --directory; elif command -v kdialog >/dev/null 2>&1; then kdialog --getexistingdirectory; else exit 127; fi'],
        { encoding: 'utf-8' }
      );

      if (result.status === 0) {
        const pickedPath = (result.stdout || '').trim();
        if (pickedPath) {
          return { success: true, path: pickedPath };
        }
        return { success: false, cancelled: true };
      }

      if (result.status === 127) {
        return { success: false, error: '当前系统缺少目录选择器（请安装 zenity 或 kdialog）' };
      }

      const output = `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase();
      if (output.includes('cancel')) {
        return { success: false, cancelled: true };
      }
      return { success: false, error: (result.stderr || '目录选择失败').trim() };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Memory API methods
  async listMemories(type?: string): Promise<{ success: boolean; memories?: any[]; error?: string }> {
    try {
      const memories = await this.memoryManager.list(type as any);
      return {
        success: true,
        memories: memories.map(m => ({
          id: m.id,
          name: m.metadata.name,
          description: m.metadata.description,
          type: m.metadata.type,
          created: m.metadata.created,
          updated: m.metadata.updated,
          content: m.content
        }))
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getMemory(id: string): Promise<{ success: boolean; memory?: any; error?: string }> {
    try {
      const memory = await this.memoryManager.read(id);
      if (!memory) {
        return {
          success: false,
          error: 'Memory not found'
        };
      }
      return {
        success: true,
        memory: {
          id: memory.id,
          name: memory.metadata.name,
          description: memory.metadata.description,
          type: memory.metadata.type,
          created: memory.metadata.created,
          updated: memory.metadata.updated,
          content: memory.content
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async createMemory(input: MemoryCreateInput): Promise<{ success: boolean; memory?: any; error?: string }> {
    try {
      const memory = await this.memoryManager.create(input);
      return {
        success: true,
        memory: {
          id: memory.id,
          name: memory.metadata.name,
          description: memory.metadata.description,
          type: memory.metadata.type,
          created: memory.metadata.created,
          updated: memory.metadata.updated,
          content: memory.content
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateMemory(id: string, input: MemoryUpdateInput): Promise<{ success: boolean; memory?: any; error?: string }> {
    try {
      const memory = await this.memoryManager.update(id, input);
      if (!memory) {
        return {
          success: false,
          error: 'Memory not found'
        };
      }
      return {
        success: true,
        memory: {
          id: memory.id,
          name: memory.metadata.name,
          description: memory.metadata.description,
          type: memory.metadata.type,
          created: memory.metadata.created,
          updated: memory.metadata.updated,
          content: memory.content
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteMemory(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const deleted = await this.memoryManager.delete(id);
      if (!deleted) {
        return {
          success: false,
          error: 'Memory not found'
        };
      }
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async searchMemories(query: string): Promise<{ success: boolean; memories?: any[]; error?: string }> {
    try {
      const memories = await this.memoryManager.search(query);
      return {
        success: true,
        memories: memories.map(m => ({
          id: m.id,
          name: m.metadata.name,
          description: m.metadata.description,
          type: m.metadata.type,
          created: m.metadata.created,
          updated: m.metadata.updated,
          content: m.content
        }))
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async compressConversation(conversationId?: string, manual: boolean = false): Promise<{ success: boolean; strategy?: string; tokensSaved?: number; usage?: number; error?: string }> {
    try {
      const id = conversationId || this.currentConversationId;
      if (!id) {
        return {
          success: false,
          error: 'No active conversation'
        };
      }

      const result = await this.conversationManager.compressConversation(id, manual);

      if (result.success) {
        const usage = this.conversationManager.getUsagePercentage(id);
        return {
          success: true,
          strategy: result.strategy,
          tokensSaved: result.tokensSaved,
          usage
        };
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getConversationUsage(conversationId?: string): Promise<{ success: boolean; usage?: number; error?: string }> {
    try {
      const id = conversationId || this.currentConversationId;
      if (!id) {
        return {
          success: false,
          error: 'No active conversation'
        };
      }

      const usage = this.conversationManager.getUsagePercentage(id);
      return {
        success: true,
        usage
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Trigger manual memory extraction
  async triggerManualExtraction(conversationId?: string): Promise<{
    success: boolean;
    created: number;
    skipped: number;
    errors: string[];
  }> {
    try {
      const id = conversationId || this.currentConversationId;
      if (!id) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          errors: ['No active conversation']
        };
      }

      return await this.conversationManager.manualExtraction(id);
    } catch (error: any) {
      return {
        success: false,
        created: 0,
        skipped: 0,
        errors: [error.message]
      };
    }
  }

  // Get extraction config
  async getExtractionConfig(): Promise<{
    success: boolean;
    config?: any;
    error?: string;
  }> {
    try {
      const { ConfigManager } = await import('../memory/config-manager');
      const configManager = new ConfigManager();
      await configManager.init();
      const config = configManager.get();

      return {
        success: true,
        config
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Save extraction config
  async saveExtractionConfig(config: any): Promise<{
    success: boolean;
    config?: any;
    error?: string;
  }> {
    try {
      const { ConfigManager } = await import('../memory/config-manager');
      const configManager = new ConfigManager();
      await configManager.init();
      const updated = await configManager.save(config);

      return {
        success: true,
        config: updated
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get extraction stats
  async getExtractionStats(): Promise<{
    success: boolean;
    stats?: {
      totalAutoCreated: number;
      totalMemories: number;
      lastExtractionTime: string | null;
    };
    error?: string;
  }> {
    try {
      const memories = await this.memoryManager.list();
      const autoCreated = memories.filter(m => (m.metadata as any).autoCreated);

      return {
        success: true,
        stats: {
          totalAutoCreated: autoCreated.length,
          totalMemories: memories.length,
          lastExtractionTime: null // TODO: Track this in extraction state
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
