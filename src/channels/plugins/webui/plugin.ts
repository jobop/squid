import { WebSocketServer, WebSocket } from 'ws';
import {
  ChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelOutboundAdapter,
  ChannelInboundAdapter,
  ChannelStatusAdapter,
  ChannelSetupAdapter,
  NotificationMessage,
  NotificationResult,
} from '../../types';
import { eventBridge, TaskCompleteEvent } from '../../bridge/event-bridge';

/**
 * WebSocket 消息类型
 */
interface WebSocketMessage {
  type: 'task:complete' | 'notification' | 'command' | 'ping' | 'pong';
  data?: any;
}

/**
 * WebUI Channel 插件配置
 */
interface WebUIConfig {
  port: number;
  heartbeatInterval: number;
}

/**
 * WebUI Channel 插件 - 将聊天框作为 channel 实现
 */
export class WebUIChannelPlugin implements ChannelPlugin {
  id = 'webui';

  meta: ChannelMeta = {
    name: 'WebUI Channel',
    description: '聊天框 WebSocket 通道',
    icon: '💬',
    category: 'builtin',
  };

  capabilities: ChannelCapabilities = {
    outbound: {
      text: true,
      media: false,
      rich: true,
      streaming: true,
    },
    inbound: {
      text: true,
      commands: true,
      interactive: true,
    },
  };

  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private heartbeatTimer?: NodeJS.Timeout;
  private defaultConfig: WebUIConfig = {
    port: 8080,
    heartbeatInterval: 30000, // 30秒
  };

  config: ChannelConfigAdapter = {
    get: <T>(key: string): T | undefined => {
      return (this.defaultConfig as any)[key];
    },
    set: <T>(key: string, value: T): void => {
      (this.defaultConfig as any)[key] = value;
    },
    getAll: () => this.defaultConfig,
    validate: () => true,
  };

  outbound: ChannelOutboundAdapter = {
    sendText: async (params) => {
      return this.broadcast({
        type: 'notification',
        data: {
          content: params.content,
          title: params.title,
          type: 'info',
        },
      });
    },
    sendNotification: async (message) => {
      return this.broadcast({
        type: 'notification',
        data: message,
      });
    },
  };

  inbound: ChannelInboundAdapter = {
    onMessage: (callback) => {
      // 消息处理在 handleClientMessage 中实现
      this.messageCallback = callback;
    },
  };

  status: ChannelStatusAdapter = {
    check: async () => {
      const isHealthy = this.wss !== undefined && this.clients.size >= 0;
      return {
        healthy: isHealthy,
        message: isHealthy
          ? `WebSocket service running, ${this.clients.size} client(s) connected`
          : 'WebSocket service is not started',
      };
    },
  };

  setup: ChannelSetupAdapter = {
    initialize: async () => {
      await this.startWebSocketServer();
      this.subscribeToEvents();
      this.startHeartbeat();
    },
    cleanup: async () => {
      this.stopHeartbeat();
      this.unsubscribeFromEvents();
      await this.stopWebSocketServer();
    },
  };

  private messageCallback?: (message: any) => void;
  private taskCompleteHandler?: (event: TaskCompleteEvent) => void;

  /**
   * 启动 WebSocket 服务器
   */
  private async startWebSocketServer(): Promise<void> {
    const port = this.config.get<number>('port') || 8080;

    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WebUI] Client connected');
      this.clients.add(ws);

      ws.on('message', (data: Buffer) => {
        this.handleClientMessage(ws, data);
      });

      ws.on('close', () => {
        console.log('[WebUI] Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebUI] WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'notification',
        data: {
          content: 'WebSocket connected',
          type: 'success',
        },
      }));
    });

    console.log(`[WebUI] WebSocket server started on port ${port}`);
  }

  /**
   * Stop WebSocket server
   */
  private async stopWebSocketServer(): Promise<void> {
    if (this.wss) {
      this.clients.forEach(client => client.close());
      this.clients.clear();

      await new Promise<void>((resolve) => {
        this.wss!.close(() => {
          console.log('[WebUI] WebSocket server stopped');
          resolve();
        });
      });

      this.wss = undefined;
    }
  }

  /**
   * 处理客户端消息
   */
  private handleClientMessage(ws: WebSocket, data: Buffer): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'command':
          // 转发命令到 EventBridge
          if (message.data) {
            eventBridge.sendCommand(
              message.data.command,
              message.data.args,
              this.id
            );
          }
          break;

        case 'ping':
          // 响应心跳
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          // 其他消息通过 inbound 回调处理
          if (this.messageCallback) {
            this.messageCallback(message);
          }
      }
    } catch (error) {
      console.error('[WebUI] Failed to parse message:', error);
    }
  }

  /**
   * 广播消息到所有客户端
   */
  private broadcast(message: WebSocketMessage): NotificationResult {
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let errorCount = 0;

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          successCount++;
        } catch (error) {
          console.error('[WebUI] Failed to send message:', error);
          errorCount++;
        }
      }
    });

    return {
      success: errorCount === 0,
      error: errorCount > 0 ? `${errorCount} client(s) failed to receive message` : undefined,
    };
  }

  /**
   * 订阅 EventBridge 事件
   */
  private subscribeToEvents(): void {
    this.taskCompleteHandler = (event: TaskCompleteEvent) => {
      this.broadcast({
        type: 'task:complete',
        data: event,
      });
    };

    eventBridge.onTaskComplete(this.taskCompleteHandler);
  }

  /**
   * 取消订阅 EventBridge 事件
   */
  private unsubscribeFromEvents(): void {
    if (this.taskCompleteHandler) {
      eventBridge.offTaskComplete(this.taskCompleteHandler);
      this.taskCompleteHandler = undefined;
    }
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    const interval = this.config.get<number>('heartbeatInterval') || 30000;

    this.heartbeatTimer = setInterval(() => {
      this.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify({ type: 'ping' }));
          } catch (error) {
            console.error('[WebUI] Failed to send heartbeat:', error);
            this.clients.delete(client);
          }
        } else {
          this.clients.delete(client);
        }
      });
    }, interval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
