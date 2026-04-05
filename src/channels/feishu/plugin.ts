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
} from '../types';
import { eventBridge, TaskCompleteEvent } from '../bridge/event-bridge';
import {
  loadFeishuChannelConfigSync,
  toFeishuConfigPublicView,
  validateFeishuOutboundConfig,
} from './config-store';
import { getTenantAccessToken, sendFeishuTextMessage } from './lark-client';
import { startFeishuWebSocketInbound, type FeishuWsInboundHandle } from './feishu-ws-inbound';

/**
 * 飞书开放平台直连 Channel（不依赖 OpenClaw 飞书插件运行时）
 */
export class FeishuChannelPlugin implements ChannelPlugin {
  id = 'feishu';

  meta: ChannelMeta = {
    name: 'Feishu / Lark',
    description: '飞书机器人（默认 WebSocket 长连接入站 + tenant 发消息）',
    icon: '📗',
    category: 'builtin',
  };

  capabilities: ChannelCapabilities = {
    outbound: { text: true, media: false, rich: false, streaming: false },
    inbound: { text: true, commands: false, interactive: false },
  };

  private taskCompleteHandler?: (event: TaskCompleteEvent) => void;
  private wsInbound?: FeishuWsInboundHandle;

  config: ChannelConfigAdapter = {
    get: <T>(key: string): T | undefined => {
      const all = toFeishuConfigPublicView(loadFeishuChannelConfigSync()) as Record<string, unknown>;
      return all[key] as T | undefined;
    },
    set: <T>(_key: string, _value: T): void => {
      /* 凭证经 ~/.squid/feishu-channel.json 与 REST API 更新 */
    },
    getAll: () => toFeishuConfigPublicView(loadFeishuChannelConfigSync()) as Record<string, unknown>,
    validate: () => validateFeishuOutboundConfig(loadFeishuChannelConfigSync() ?? {}).ok,
  };

  outbound: ChannelOutboundAdapter = {
    sendText: async (params) => {
      const c = loadFeishuChannelConfigSync();
      if (!c) {
        return { success: false, error: '未配置 ~/.squid/feishu-channel.json' };
      }
      let text = params.content;
      if (params.title) {
        text = `**${params.title}**\n\n${text}`;
      }
      return sendFeishuTextMessage(c, text);
    },
    sendNotification: async (message: NotificationMessage) => {
      const c = loadFeishuChannelConfigSync();
      if (!c) {
        return { success: false, error: '未配置 ~/.squid/feishu-channel.json' };
      }
      let text = message.content;
      if (message.title) {
        text = `**${message.title}**\n\n${text}`;
      }
      return sendFeishuTextMessage(c, text);
    },
  };

  inbound: ChannelInboundAdapter = {
    onMessage: () => {
      console.warn(
        '[Feishu] 默认经 WebSocket 长连接入站；webhook 模式见 POST /api/feishu/webhook；下游可订阅 eventBridge.onChannelInbound'
      );
    },
  };

  status: ChannelStatusAdapter = {
    check: async () => {
      const c = loadFeishuChannelConfigSync();
      if (!c) {
        return { healthy: false, message: '未配置 feishu-channel.json' };
      }
      const v = validateFeishuOutboundConfig(c);
      if (!v.ok) {
        return { healthy: false, message: v.errors.join('; ') };
      }
      const t = await getTenantAccessToken(c);
      if (!t.ok) {
        return { healthy: false, message: t.error };
      }
      return { healthy: true, message: 'tenant token 可用' };
    },
  };

  setup: ChannelSetupAdapter = {
    initialize: async () => {
      const cfg = loadFeishuChannelConfigSync();
      const mode = cfg?.connectionMode ?? 'websocket';
      if (mode === 'websocket' && cfg?.appId?.trim() && cfg.appSecret?.trim()) {
        this.wsInbound = startFeishuWebSocketInbound(cfg);
      }

      this.taskCompleteHandler = (event: TaskCompleteEvent) => {
        const text = event.error
          ? `❌ 任务失败\n任务: ${event.taskId}\n错误: ${event.error}`
          : `✅ 任务完成\n任务: ${event.taskId}`;
        this.outbound.sendText({ content: text }).catch((err) => {
          console.error('[Feishu] 发送任务完成通知失败:', err);
        });
      };
      eventBridge.onTaskComplete(this.taskCompleteHandler);
    },
    cleanup: async () => {
      this.wsInbound?.stop();
      this.wsInbound = undefined;
      if (this.taskCompleteHandler) {
        eventBridge.offTaskComplete(this.taskCompleteHandler);
        this.taskCompleteHandler = undefined;
      }
    },
  };
}
