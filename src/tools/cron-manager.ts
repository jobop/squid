import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { enqueuePendingNotification } from '../utils/messageQueueManager';
import { appendFile, readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface CronTask {
  id: string;
  expression: string;
  content: string;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  isRunning: boolean;
  runningAtMs?: Date;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  consecutiveErrors?: number;
  lastReplayAt?: Date;
}

export interface CronManagerStatus {
  enabled: boolean;
  totalTasks: number;
  runningTasks: number;
  nextWakeAt?: Date;
  storagePath?: string;
  lastRestoreAt?: Date;
  scheduledReplayCount?: number;
}

export interface CronRunLogEntry {
  id: string;
  ts: string;
  taskId: string;
  trigger: 'schedule' | 'retry' | 'replay';
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  content?: string;
  durationMs: number;
}

export interface CronRunLogPageResult {
  entries: CronRunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface StoredCronTask {
  id: string;
  expression: string;
  content: string;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  runningAtMs?: string;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  consecutiveErrors?: number;
  lastReplayAt?: string;
}

/** 入队后通知宿主触发该会话 drain（由 bun 注入 TaskAPI.kickConversationQueueDrain） */
type EnqueueDrainNotifier = (conversationId: string) => void;

class CronManager {
  private static readonly RETRY_BACKOFF_MS = [30_000, 60_000, 5 * 60_000];
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly STARTUP_REPLAY_LIMIT = 5;
  private static readonly STARTUP_REPLAY_STAGGER_MS = 3_000;

  private tasks: Map<string, { task: cron.ScheduledTask; info: CronTask }> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private runLogEntries: CronRunLogEntry[] = [];
  private enqueueDrainNotifier?: EnqueueDrainNotifier;
  private readonly storagePath?: string;
  private readonly runLogDir?: string;
  private lastRestoreAt?: Date;
  private scheduledReplayCount = 0;

  constructor() {
    const persistenceEnabled = process.env.VITEST !== '1' && process.env.SQUID_CRON_PERSIST !== '0';
    if (persistenceEnabled) {
      this.storagePath = join(homedir(), '.squid', 'cron', 'jobs.json');
      this.runLogDir = join(homedir(), '.squid', 'cron', 'runs');
    }
  }

  /**
   * 设置入队后的 drain 回调（与 TaskAPI 对齐：仅入队，由队列处理器执行）
   */
  setEnqueueDrainNotifier(cb: EnqueueDrainNotifier | undefined): void {
    this.enqueueDrainNotifier = cb;
  }

  private toStoredTask(task: CronTask): StoredCronTask {
    return {
      id: task.id,
      expression: task.expression,
      content: task.content,
      createdAt: task.createdAt.toISOString(),
      lastRun: task.lastRun?.toISOString(),
      nextRun: task.nextRun?.toISOString(),
      runningAtMs: task.runningAtMs?.toISOString(),
      lastStatus: task.lastStatus,
      lastError: task.lastError,
      consecutiveErrors: task.consecutiveErrors,
      lastReplayAt: task.lastReplayAt?.toISOString(),
    };
  }

  private fromStoredTask(input: StoredCronTask): CronTask | null {
    const createdAt = new Date(input.createdAt);
    if (!input.id || !input.expression || !input.content || Number.isNaN(createdAt.getTime())) {
      return null;
    }
    const lastRun =
      typeof input.lastRun === 'string' && input.lastRun.length > 0 ? new Date(input.lastRun) : undefined;
    const runningAtMs =
      typeof input.runningAtMs === 'string' && input.runningAtMs.length > 0
        ? new Date(input.runningAtMs)
        : undefined;
    const lastReplayAt =
      typeof input.lastReplayAt === 'string' && input.lastReplayAt.length > 0
        ? new Date(input.lastReplayAt)
        : undefined;
    const nextRun =
      typeof input.nextRun === 'string' && input.nextRun.length > 0 ? new Date(input.nextRun) : undefined;
    return {
      id: input.id,
      expression: input.expression,
      content: input.content,
      createdAt,
      lastRun: lastRun && !Number.isNaN(lastRun.getTime()) ? lastRun : undefined,
      nextRun: nextRun && !Number.isNaN(nextRun.getTime()) ? nextRun : undefined,
      runningAtMs: runningAtMs && !Number.isNaN(runningAtMs.getTime()) ? runningAtMs : undefined,
      lastStatus:
        input.lastStatus === 'ok' || input.lastStatus === 'error' || input.lastStatus === 'skipped'
          ? input.lastStatus
          : undefined,
      lastError: typeof input.lastError === 'string' ? input.lastError : undefined,
      consecutiveErrors:
        typeof input.consecutiveErrors === 'number' && Number.isFinite(input.consecutiveErrors)
          ? Math.max(0, Math.floor(input.consecutiveErrors))
          : 0,
      lastReplayAt: lastReplayAt && !Number.isNaN(lastReplayAt.getTime()) ? lastReplayAt : undefined,
      isRunning: false,
    };
  }

  private async persistTasks(): Promise<void> {
    if (!this.storagePath) {
      return;
    }
    const payload = Array.from(this.tasks.values()).map((entry) => this.toStoredTask(entry.info));
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private computeNextRun(expression: string, fromDate = new Date()): Date | undefined {
    try {
      const interval = CronExpressionParser.parse(expression, { currentDate: fromDate });
      return interval.next().toDate();
    } catch {
      return undefined;
    }
  }

  private async appendRunLog(entry: CronRunLogEntry): Promise<void> {
    this.runLogEntries.push(entry);
    if (this.runLogEntries.length > 5000) {
      this.runLogEntries = this.runLogEntries.slice(this.runLogEntries.length - 5000);
    }
    if (!this.runLogDir) {
      return;
    }
    const filePath = join(this.runLogDir, `${entry.taskId}.jsonl`);
    await mkdir(this.runLogDir, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }

  private parseRunLogLine(raw: string): CronRunLogEntry | null {
    try {
      const parsed = JSON.parse(raw) as CronRunLogEntry;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.id !== 'string' ||
        typeof parsed.taskId !== 'string' ||
        typeof parsed.ts !== 'string' ||
        (parsed.status !== 'ok' && parsed.status !== 'error' && parsed.status !== 'skipped') ||
        (parsed.trigger !== 'schedule' && parsed.trigger !== 'retry' && parsed.trigger !== 'replay') ||
        typeof parsed.durationMs !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async loadRunLogEntries(taskId?: string): Promise<CronRunLogEntry[]> {
    const fromMemory = this.runLogEntries;
    if (!this.runLogDir) {
      return taskId ? fromMemory.filter((entry) => entry.taskId === taskId) : fromMemory;
    }

    const targets: string[] = [];
    if (taskId) {
      targets.push(join(this.runLogDir, `${taskId}.jsonl`));
    } else {
      try {
        const files = await readdir(this.runLogDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && file.name.endsWith('.jsonl')) {
            targets.push(join(this.runLogDir, file.name));
          }
        }
      } catch {
        // ignore
      }
    }

    const fromDisk: CronRunLogEntry[] = [];
    for (const filePath of targets) {
      try {
        const raw = await readFile(filePath, 'utf-8');
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          const parsed = this.parseRunLogLine(line);
          if (parsed) {
            fromDisk.push(parsed);
          }
        }
      } catch {
        // ignore broken file
      }
    }

    const dedup = new Map<string, CronRunLogEntry>();
    for (const entry of [...fromDisk, ...fromMemory]) {
      dedup.set(entry.id, entry);
    }
    const merged = Array.from(dedup.values());
    return taskId ? merged.filter((entry) => entry.taskId === taskId) : merged;
  }

  private scheduleRetry(taskInfo: CronTask): void {
    const consecutiveErrors = taskInfo.consecutiveErrors ?? 0;
    if (consecutiveErrors <= 0 || consecutiveErrors > CronManager.MAX_RETRY_ATTEMPTS) {
      return;
    }
    const retryIndex = Math.min(consecutiveErrors - 1, CronManager.RETRY_BACKOFF_MS.length - 1);
    const backoffMs = CronManager.RETRY_BACKOFF_MS[retryIndex]!;
    taskInfo.nextRun = new Date(Date.now() + backoffMs);
    const existing = this.retryTimers.get(taskInfo.id);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(taskInfo.id);
      const current = this.tasks.get(taskInfo.id);
      if (!current) {
        return;
      }
      void this.executeTask(current.info, 'retry');
    }, backoffMs);
    this.retryTimers.set(taskInfo.id, timer);
  }

  private scheduleStartupReplay(taskInfo: CronTask, index: number): void {
    const delay = index * CronManager.STARTUP_REPLAY_STAGGER_MS;
    this.scheduledReplayCount += 1;
    taskInfo.nextRun = new Date(Date.now() + delay);
    setTimeout(() => {
      const current = this.tasks.get(taskInfo.id);
      if (!current) {
        return;
      }
      current.info.lastReplayAt = new Date();
      void this.executeTask(current.info, 'replay');
    }, delay);
  }

  private async executeTask(taskInfo: CronTask, trigger: 'schedule' | 'retry' | 'replay'): Promise<void> {
    const taskId = taskInfo.id;
    const conversationId = `cron:${taskId}`;
    if (taskInfo.isRunning || taskInfo.runningAtMs) {
      console.warn(`[Cron ${taskId}] 任务仍在运行，跳过 ${trigger} 触发`);
      return;
    }

    const startedAt = new Date();
    const startMs = Date.now();
    taskInfo.isRunning = true;
    taskInfo.runningAtMs = startedAt;
    await this.persistTasks().catch((error) => {
      console.error(`[Cron ${taskId}] 持久化 runningAtMs 失败:`, error);
    });

    console.log(`[Cron ${taskId}] 任务触发(${trigger}): ${taskInfo.content}`);
    try {
      enqueuePendingNotification({
        conversationId,
        value: taskInfo.content,
        priority: 'later',
        isMeta: true,
        source: 'cron',
        taskId,
      });
      console.log(
        `[Cron ${taskId}] 已入队 conversationId=%s，等待 TaskAPI drain`,
        conversationId
      );
      this.enqueueDrainNotifier?.(conversationId);
      taskInfo.lastRun = startedAt;
      taskInfo.lastStatus = 'ok';
      taskInfo.lastError = undefined;
      taskInfo.consecutiveErrors = 0;
      taskInfo.nextRun = this.computeNextRun(taskInfo.expression, startedAt);
      void this.appendRunLog({
        id: `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        ts: new Date().toISOString(),
        taskId,
        trigger,
        status: 'ok',
        content: taskInfo.content,
        durationMs: Date.now() - startMs,
      }).catch((error) => {
        console.error(`[Cron ${taskId}] 写入 run log 失败:`, error);
      });
    } catch (error) {
      taskInfo.lastStatus = 'error';
      taskInfo.lastError = (error as Error).message;
      taskInfo.consecutiveErrors = (taskInfo.consecutiveErrors ?? 0) + 1;
      console.error(`[Cron ${taskId}] 入队失败:`, error);
      void this.appendRunLog({
        id: `${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        ts: new Date().toISOString(),
        taskId,
        trigger,
        status: 'error',
        error: (error as Error).message,
        content: taskInfo.content,
        durationMs: Date.now() - startMs,
      }).catch((runLogError) => {
        console.error(`[Cron ${taskId}] 写入 run log 失败:`, runLogError);
      });
      this.scheduleRetry(taskInfo);
    } finally {
      taskInfo.isRunning = false;
      taskInfo.runningAtMs = undefined;
      await this.persistTasks().catch((error) => {
        console.error(`[Cron ${taskId}] 持久化 lastRun 失败:`, error);
      });
    }
  }

  private registerTask(taskInfo: CronTask, options?: { persist?: boolean }): { success: boolean; error?: string } {
    const taskId = taskInfo.id;
    try {
      taskInfo.nextRun = this.computeNextRun(taskInfo.expression, new Date());
      const scheduledTask = cron.schedule(taskInfo.expression, async () => {
        await this.executeTask(taskInfo, 'schedule');
      });

      scheduledTask.start();
      this.tasks.set(taskId, { task: scheduledTask, info: taskInfo });

      if (options?.persist !== false) {
        void this.persistTasks().catch((error) => {
          console.error(`[Cron ${taskId}] 持久化失败:`, error);
        });
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async restoreTasks(): Promise<{ restored: number; failed: number; replayScheduled: number }> {
    this.scheduledReplayCount = 0;
    if (!this.storagePath) {
      return { restored: 0, failed: 0, replayScheduled: 0 };
    }
    try {
      const raw = await readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredCronTask[];
      if (!Array.isArray(parsed)) {
        return { restored: 0, failed: 0, replayScheduled: 0 };
      }

      let restored = 0;
      let failed = 0;
      const replayCandidates: CronTask[] = [];
      for (const item of parsed) {
        const normalized = this.fromStoredTask(item);
        if (!normalized) {
          failed += 1;
          continue;
        }
        if (!cron.validate(normalized.expression) || this.tasks.has(normalized.id)) {
          failed += 1;
          continue;
        }
        const result = this.registerTask(normalized, { persist: false });
        if (result.success) {
          restored += 1;
          if (normalized.runningAtMs) {
            normalized.lastStatus = 'error';
            normalized.lastError = '任务在上次运行中断，已在启动后补跑';
            normalized.runningAtMs = undefined;
            replayCandidates.push(normalized);
          }
        } else {
          failed += 1;
        }
      }
      replayCandidates
        .sort((a, b) => (a.lastRun?.getTime() ?? 0) - (b.lastRun?.getTime() ?? 0))
        .slice(0, CronManager.STARTUP_REPLAY_LIMIT)
        .forEach((candidate, index) => this.scheduleStartupReplay(candidate, index));

      this.lastRestoreAt = new Date();
      await this.persistTasks().catch((error) => {
        console.error('[Cron] 启动恢复后持久化失败:', error);
      });
      return { restored, failed, replayScheduled: this.scheduledReplayCount };
    } catch {
      return { restored: 0, failed: 0, replayScheduled: 0 };
    }
  }

  getStatus(): CronManagerStatus {
    let runningTasks = 0;
    let nextWakeAt: Date | undefined;
    for (const entry of this.tasks.values()) {
      if (entry.info.isRunning) {
        runningTasks += 1;
      }
      if (entry.info.nextRun) {
        if (!nextWakeAt || entry.info.nextRun.getTime() < nextWakeAt.getTime()) {
          nextWakeAt = entry.info.nextRun;
        }
      }
    }
    return {
      enabled: Boolean(this.storagePath),
      totalTasks: this.tasks.size,
      runningTasks,
      nextWakeAt,
      storagePath: this.storagePath,
      lastRestoreAt: this.lastRestoreAt,
      scheduledReplayCount: this.scheduledReplayCount,
    };
  }

  async getRuns(opts?: {
    taskId?: string;
    limit?: number;
    offset?: number;
    status?: 'ok' | 'error' | 'skipped' | 'all';
  }): Promise<CronRunLogPageResult> {
    const status = opts?.status ?? 'all';
    const limit = Math.max(1, Math.min(200, Math.floor(opts?.limit ?? 50)));
    const all = await this.loadRunLogEntries(opts?.taskId);
    const filtered = all.filter((entry) => (status === 'all' ? true : entry.status === status));
    const sorted = filtered.toSorted((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    const total = sorted.length;
    const offset = Math.max(0, Math.min(total, Math.floor(opts?.offset ?? 0)));
    const entries = sorted.slice(offset, offset + limit);
    const nextOffset = offset + entries.length;
    return {
      entries,
      total,
      offset,
      limit,
      hasMore: nextOffset < total,
      nextOffset: nextOffset < total ? nextOffset : null,
    };
  }

  /**
   * 创建定时任务（触发时只入队，不直接调用 LLM）
   */
  createTask(expression: string, content: string): { success: boolean; taskId?: string; error?: string } {
    if (!cron.validate(expression)) {
      return {
        success: false,
        error: `无效的 cron 表达式: ${expression}`,
      };
    }

    const taskId = `cron-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const taskInfo: CronTask = {
      id: taskId,
      expression,
      content,
      createdAt: new Date(),
      isRunning: false,
    };
    const result = this.registerTask(taskInfo);
    if (result.success) {
      return {
        success: true,
        taskId,
      };
    }
    return {
      success: false,
      error: result.error,
    };
  }

  deleteTask(taskId: string): { success: boolean; error?: string } {
    const taskEntry = this.tasks.get(taskId);

    if (!taskEntry) {
      return {
        success: false,
        error: `任务不存在: ${taskId}`,
      };
    }

    try {
      taskEntry.task.stop();
      const retryTimer = this.retryTimers.get(taskId);
      if (retryTimer) {
        clearTimeout(retryTimer);
        this.retryTimers.delete(taskId);
      }
      this.tasks.delete(taskId);
      void this.persistTasks().catch((error) => {
        console.error(`[Cron ${taskId}] 删除后持久化失败:`, error);
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  listTasks(): CronTask[] {
    return Array.from(this.tasks.values())
      .map((entry) => ({ ...entry.info }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  getTask(taskId: string): CronTask | undefined {
    const taskEntry = this.tasks.get(taskId);
    return taskEntry ? { ...taskEntry.info } : undefined;
  }

  clear(): void {
    this.tasks.forEach((entry) => entry.task.stop());
    this.tasks.clear();
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
    this.runLogEntries = [];
    void this.persistTasks().catch((error) => {
      console.error('[Cron] clear 后持久化失败:', error);
    });
  }
}

export const cronManager = new CronManager();
