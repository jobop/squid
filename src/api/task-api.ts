// Task execution API
import { TaskExecutor } from '../tasks/executor';
import { TaskMode } from '../tasks/types';
import { WorkspaceSandbox } from '../workspace/sandbox';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';
import { ExpertManager } from '../experts/manager';
import { ConversationManager } from '../conversation/manager';
import type { Message as ConversationMessage } from '../conversation/manager';
import { MemoryManager } from '../memory/manager';
import type { MemoryCreateInput, MemoryUpdateInput } from '../memory/types';
import { saveMemoryTool } from '../tools/save-memory';
import { WebFetchTool } from '../tools/web-fetch';
import { FileEditTool } from '../tools/file-edit';
import { BashTool } from '../tools/bash';
import { PowerShellTool } from '../tools/powershell';
import { WebSearchTool } from '../tools/web-search';
import { CronCreateTool } from '../tools/cron-create';
import { CronDeleteTool } from '../tools/cron-delete';
import { CronListTool } from '../tools/cron-list';
import { SkillTool } from '../tools/skill';
import { BriefTool } from '../tools/brief';
import { AgentTool } from '../tools/agent';
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

/** 同会话已有执行中任务时抛出，由 HTTP / Channel 捕获并入队 */
export class TaskAPIConversationBusyError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`conversation busy: ${conversationId}`);
    this.name = 'TaskAPIConversationBusyError';
    this.conversationId = conversationId;
  }
}

export function isTaskAPIConversationBusyError(
  e: unknown
): e is TaskAPIConversationBusyError {
  if (e instanceof TaskAPIConversationBusyError) return true;
  // 动态 import 的扩展与宿主各有一份本模块时，instanceof 会失效；用 name + conversationId 识别
  if (e !== null && typeof e === 'object') {
    const o = e as { name?: unknown; conversationId?: unknown };
    if (
      o.name === 'TaskAPIConversationBusyError' &&
      typeof o.conversationId === 'string'
    ) {
      return true;
    }
  }
  return false;
}

export interface TaskRequest {
  mode: TaskMode;
  workspace: string;
  instruction: string;
  apiKey?: string;
  baseURL?: string;
  modelName?: string;
  skill?: string;
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
    this.toolRegistry.register(WebFetchTool);
    this.toolRegistry.register(FileEditTool);
    this.toolRegistry.register(BashTool);
    this.toolRegistry.register(PowerShellTool);
    this.toolRegistry.register(WebSearchTool);
    this.toolRegistry.register(CronCreateTool);
    this.toolRegistry.register(CronDeleteTool);
    this.toolRegistry.register(CronListTool);
    this.toolRegistry.register(SkillTool);
    this.toolRegistry.register(BriefTool);
    this.toolRegistry.register(AgentTool);

    this.executor = new TaskExecutor(
      this.skillLoader,
      this.toolRegistry
    );

    // 初始化对话管理器和记忆管理器
    this.conversationManager.init();
    this.memoryManager.init();

    // Fire-and-forget self-healing: restore installed SkillHub files if lock exists.
    this.repairTencentInstalledSkills().catch((error) => {
      console.warn('[SkillHub] repair skipped:', error?.message || error);
    });
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
    if (this.currentConversationId) return this.currentConversationId;
    return '__squid_default_conversation__';
  }

  isConversationBusy(conversationId: string): boolean {
    return this.runningConversations.has(conversationId);
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
    const channelReply = TaskAPI.resolveChannelReplyMeta(meta);
    const cmd: QueuedCommand = {
      conversationId: cid,
      value: request.instruction,
      mode: request.mode,
      workspace: request.workspace,
      expertId: request.expertId,
      skill: request.skill,
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
          expertId: cmd.expertId,
          skill: cmd.skill,
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

  async listSkills(): Promise<Array<{ name: string; description: string; effort: string }>> {
    const skills = await this.skillLoader.loadAll();
    return Array.from(skills.values()).map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      effort: skill.metadata.effort || 'medium'
    }));
  }

  async generateSkill(description: string): Promise<{ success: boolean; yaml?: string; error?: string }> {
    try {
      // TODO: 调用 LLM 生成技能 YAML
      // 这里先返回一个模板
      const yaml = `---
name: custom-skill
description: ${description}
when-to-use: 根据用户需求使用
allowed-tools:
  - Read
  - Write
  - Bash
effort: medium
user-invocable: true
---

你是一个专业的助手，专注于：${description}

请根据用户的指令完成任务。`;

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
        console.log('Executing task:', request);

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

        const result = await this.executor.execute({
          mode: request.mode,
          instruction: request.instruction,
          workspace: request.workspace,
        });

        const task = this.tasks.get(taskId);
        if (task) {
          task.status = result.error ? 'failed' : 'completed';
        }

        if (result.error) {
          return {
            success: false,
            error: result.error,
            output: result.output,
            files: result.files || [],
          };
        }

        return {
          success: true,
          output: result.output,
          files: result.files || [],
        };
      } catch (error: any) {
        console.error('Task execution failed:', error);

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
    const cid = this.resolveConversationIdForQueue(request);
    if (this.runningConversations.has(cid)) {
      throw new TaskAPIConversationBusyError(cid);
    }
    this.runningConversations.add(cid);
    const normalizedRequest =
      request.conversationId === '__squid_default_conversation__'
        ? { ...request, conversationId: undefined }
        : request;
    try {
      try {
        const trimmedInstruction = (normalizedRequest.instruction || '').trim();

        let conversationId = normalizedRequest.conversationId || this.currentConversationId;
        if (!conversationId) {
          conversationId = await this.conversationManager.createConversation(normalizedRequest.workspace);
          this.currentConversationId = conversationId;
        } else if (normalizedRequest.workspace) {
          await this.conversationManager.setConversationWorkspace(conversationId, normalizedRequest.workspace);
        }

        // 与 Web `/reset`、`/new` 对齐：任意走 executeTaskStream 的渠道（飞书/Telegram/队列/HTTP）共用，不经 LLM
        if (/^\/reset\b/i.test(trimmedInstruction)) {
          const r = await this.clearThreadMessages(conversationId);
          onChunk(
            r.success
              ? '✅ 已清空当前会话。'
              : `❌ 清空会话失败：${r.error ?? '未知错误'}`
          );
          return;
        }
        if (/^\/new\b/i.test(trimmedInstruction)) {
          const r = await this.newSessionClearAll(conversationId);
          onChunk(
            r.success
              ? '✅ 已清空当前会话与全部长期记忆。'
              : `❌ ${r.error ?? '操作失败'}`
          );
          return;
        }

        const modelConfig = await this.getModelConfig();
        const apiKey = (modelConfig.apiKey || '').trim();
        const baseURL = normalizedRequest.baseURL || modelConfig.apiEndpoint;
        const modelName = normalizedRequest.modelName || modelConfig.modelName;

        console.log(
          '[LLM] TaskAPI.executeTaskStream 开始 workspace=%s conversationId=%s model.provider=%s apiKey已配置=%s',
          normalizedRequest.workspace,
          normalizedRequest.conversationId || '(默认会话)',
          modelConfig.provider || '(无)',
          apiKey ? '是' : '否'
        );

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

        console.log('[LLM] TaskAPI 校验 workspace: %s', normalizedRequest.workspace);
        const sandbox = new WorkspaceSandbox(normalizedRequest.workspace);
        await sandbox.validatePath(normalizedRequest.workspace);

        let fullResponse = '';

        console.log('[LLM] TaskAPI → TaskExecutor.executeStream（模型凭证仅来自 ~/.squid/config.json）');

        await this.executor.executeStream(
          {
            mode: normalizedRequest.mode,
            instruction: normalizedRequest.instruction,
            workspace: normalizedRequest.workspace,
            conversationHistory,
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
      } catch (error: any) {
        console.error('Task execution failed:', error);

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
   * 与聊天框 `/new` 对应：清空当前（或指定）线程消息，并清空全部长期记忆文件。
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
      // TODO: 调用 LLM 生成专家定义
      // 这里先返回一个模板
      const expert = {
        name: '自定义专家',
        role: description,
        expertise: ['通用技能'],
        promptTemplate: `你是一位专业的助手，专注于：${description}\n\n请根据用户的需求提供专业的帮助。`
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
          message: 'OpenAI API 连接成功'
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
          message: 'Anthropic API 连接成功'
        };
      } else if (config.provider === 'custom') {
        // 自定义端点，根据协议类型测试
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
            message: '自定义端点（OpenAI 协议）连接成功'
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
            message: '自定义端点（Anthropic 协议）连接成功'
          };
        }
      }

      return {
        success: false,
        error: '未知的提供商类型'
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
