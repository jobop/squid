import { EventEmitter } from 'events';

/**
 * 任务完成事件数据
 */
export interface TaskCompleteEvent {
  taskId: string;
  taskName?: string;
  result?: any;
  error?: Error | string;
  duration?: number;
  timestamp: number;
}

/**
 * 命令事件数据
 */
export interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}

/** 与 `channel:inbound` 事件名一致，供测试与文档引用 */
export const CHANNEL_INBOUND_EVENT = 'channel:inbound' as const;

/**
 * 通用 Channel 入站事件（飞书等经 Adapter 投递）
 */
export interface ChannelInboundEvent {
  channelId: string;
  text: string;
  chatId?: string;
  messageId?: string;
  senderOpenId?: string;
  accountId?: string;
  raw?: Record<string, unknown>;
  timestamp: number;
}

/**
 * 事件总线 - 连接执行引擎和 channel 的双向通信
 */
export class EventBridge extends EventEmitter {
  /**
   * 通知任务完成
   * @param taskId 任务 ID
   * @param result 任务结果或错误信息
   */
  notifyTaskComplete(taskId: string, result?: any): void {
    const event: TaskCompleteEvent = {
      taskId,
      result,
      timestamp: Date.now(),
    };

    this.emit('task:complete', event);
  }

  /**
   * 订阅任务完成事件
   * @param callback 回调函数
   */
  onTaskComplete(callback: (event: TaskCompleteEvent) => void): void {
    this.on('task:complete', callback);
  }

  /**
   * 发送命令到执行引擎
   * @param command 命令名称
   * @param args 命令参数
   * @param channelId 发送命令的 channel ID
   */
  sendCommand(command: string, args?: any, channelId?: string): void {
    const event: CommandEvent = {
      command,
      args,
      channelId,
      timestamp: Date.now(),
    };

    this.emit('command', event);
  }

  /**
   * 订阅命令事件
   * @param callback 回调函数
   */
  onCommand(callback: (event: CommandEvent) => void): void {
    this.on('command', callback);
  }

  /**
   * 移除任务完成事件监听器
   * @param callback 回调函数
   */
  offTaskComplete(callback: (event: TaskCompleteEvent) => void): void {
    this.off('task:complete', callback);
  }

  /**
   * 移除命令事件监听器
   * @param callback 回调函数
   */
  offCommand(callback: (event: CommandEvent) => void): void {
    this.off('command', callback);
  }

  emitChannelInbound(payload: Omit<ChannelInboundEvent, 'timestamp'> & { timestamp?: number }): void {
    const event: ChannelInboundEvent = {
      ...payload,
      timestamp: payload.timestamp ?? Date.now(),
    };
    this.emit(CHANNEL_INBOUND_EVENT, event);
  }

  onChannelInbound(callback: (event: ChannelInboundEvent) => void): void {
    this.on(CHANNEL_INBOUND_EVENT, callback);
  }

  offChannelInbound(callback: (event: ChannelInboundEvent) => void): void {
    this.off(CHANNEL_INBOUND_EVENT, callback);
  }
}

/**
 * 全局事件总线单例
 */
export const eventBridge = new EventBridge();
