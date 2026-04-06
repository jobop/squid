import * as cron from 'node-cron';
import { enqueuePendingNotification } from '../utils/messageQueueManager';

export interface CronTask {
  id: string;
  expression: string;
  content: string;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  isRunning: boolean;
}

/** 入队后通知宿主触发该会话 drain（由 bun 注入 TaskAPI.kickConversationQueueDrain） */
type EnqueueDrainNotifier = (conversationId: string) => void;

class CronManager {
  private tasks: Map<string, { task: cron.ScheduledTask; info: CronTask }> = new Map();
  private enqueueDrainNotifier?: EnqueueDrainNotifier;

  /**
   * 设置入队后的 drain 回调（与 TaskAPI 对齐：仅入队，由队列处理器执行）
   */
  setEnqueueDrainNotifier(cb: EnqueueDrainNotifier | undefined): void {
    this.enqueueDrainNotifier = cb;
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
    const conversationId = `cron:${taskId}`;

    try {
      const taskInfo: CronTask = {
        id: taskId,
        expression,
        content,
        createdAt: new Date(),
        isRunning: false,
      };

      const scheduledTask = cron.schedule(expression, async () => {
        taskInfo.lastRun = new Date();
        taskInfo.isRunning = true;

        console.log(`[Cron ${taskId}] 任务触发: ${content}`);

        try {
          enqueuePendingNotification({
            conversationId,
            value: content,
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
        } catch (error) {
          console.error(`[Cron ${taskId}] 入队失败:`, error);
        } finally {
          taskInfo.isRunning = false;
        }
      });

      scheduledTask.start();
      this.tasks.set(taskId, { task: scheduledTask, info: taskInfo });

      return {
        success: true,
        taskId,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
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
      this.tasks.delete(taskId);

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
    return Array.from(this.tasks.values()).map((entry) => ({ ...entry.info }));
  }

  getTask(taskId: string): CronTask | undefined {
    const taskEntry = this.tasks.get(taskId);
    return taskEntry ? { ...taskEntry.info } : undefined;
  }

  clear(): void {
    this.tasks.forEach((entry) => entry.task.stop());
    this.tasks.clear();
  }
}

export const cronManager = new CronManager();
