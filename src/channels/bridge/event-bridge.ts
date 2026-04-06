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
   * 逐个调用监听器并吞掉单点异常，避免一个订阅者抛错阻断其它订阅者（与 Vitest 期望一致）
   */
  private emitSafe(eventName: string, payload: unknown): void {
    const fns = this.listeners(eventName) as ((arg: unknown) => void)[];
    for (const fn of fns) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBridge] listener error (${eventName}):`, err);
      }
    }
  }

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

    this.emitSafe('task:complete', event);
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

    this.emitSafe('command', event);
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
    this.emitSafe(CHANNEL_INBOUND_EVENT, event);
  }

  onChannelInbound(callback: (event: ChannelInboundEvent) => void): void {
    this.on(CHANNEL_INBOUND_EVENT, callback);
  }

  offChannelInbound(callback: (event: ChannelInboundEvent) => void): void {
    this.off(CHANNEL_INBOUND_EVENT, callback);
  }
}

/**
 * 进程内唯一事件总线。
 * Electrobun 等场景下「主进程 bundle」与「动态 import 的 channel 扩展」会各自执行一份模块图，
 * 若此处仅用 `new EventBridge()`，会出现两套实例：扩展里 emit、主进程里 on，彼此永远收不到。
 * 故挂到 globalThis，保证全进程共用一个 EventBridge。
 */
const EVENT_BRIDGE_GLOBAL_KEY = '__SQUID_CHANNEL_EVENT_BRIDGE__';

function getOrCreateProcessEventBridge(): EventBridge {
  const g = globalThis as Record<string, unknown>;
  const existing = g[EVENT_BRIDGE_GLOBAL_KEY];
  if (existing instanceof EventBridge) {
    return existing;
  }
  const bridge = new EventBridge();
  g[EVENT_BRIDGE_GLOBAL_KEY] = bridge;
  return bridge;
}

export const eventBridge = getOrCreateProcessEventBridge();
