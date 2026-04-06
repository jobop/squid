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
} from '../types';
import { eventBridge } from '../bridge/event-bridge';

/**
 * OpenClaw 插件适配器
 *
 * 将 OpenClaw channel 插件适配为 squid 的 ChannelPlugin 接口
 */
export class OpenClawChannelAdapter implements ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  constructor(private openclawPlugin: any, pluginId?: string) {
    this.id = pluginId || openclawPlugin.id || 'openclaw-plugin';

    this.meta = {
      name: openclawPlugin.name || 'OpenClaw Plugin',
      description: openclawPlugin.description || 'OpenClaw 插件适配',
      category: 'third-party',
    };

    // 默认能力，可根据插件类型调整
    this.capabilities = {
      outbound: {
        text: true,
        media: false,
        rich: true,
        streaming: false,
      },
      inbound: {
        text: true,
        commands: true,
        interactive: true,
      },
    };
  }

  // 配置适配器
  config: ChannelConfigAdapter = {
    get: <T>(key: string): T | undefined => {
      if (this.openclawPlugin.config) {
        return this.openclawPlugin.config[key] as T;
      }
      return undefined;
    },

    set: <T>(key: string, value: T): void => {
      if (!this.openclawPlugin.config) {
        this.openclawPlugin.config = {};
      }
      this.openclawPlugin.config[key] = value;
    },

    getAll: () => {
      return this.openclawPlugin.config || {};
    },

    validate: () => {
      // 基本验证：检查必需的配置项
      const config = this.openclawPlugin.config || {};

      // 飞书插件需要 appId 和 appSecret
      if (this.id === 'feishu') {
        return Boolean(config.appId && config.appSecret);
      }

      return true;
    },
  };

  // 出站适配器（发送消息）
  outbound: ChannelOutboundAdapter = {
    sendText: async (params) => {
      try {
        // 尝试调用 OpenClaw 插件的发送方法
        if (this.openclawPlugin.send) {
          await this.openclawPlugin.send({
            content: params.content,
            title: params.title,
          });
        } else if (this.openclawPlugin.sendMessage) {
          await this.openclawPlugin.sendMessage(params.content);
        } else {
          console.warn(`[OpenClawAdapter] 插件 ${this.id} 没有实现发送方法`);
          return {
            success: false,
            error: '插件未实现发送方法',
          };
        }

        return { success: true };
      } catch (error: any) {
        console.error(`[OpenClawAdapter] 发送消息失败:`, error);
        return {
          success: false,
          error: error.message || '发送失败',
        };
      }
    },

    sendNotification: async (message: NotificationMessage) => {
      // 将通知消息转换为文本
      let content = message.content;
      if (message.title) {
        content = `**${message.title}**\n\n${message.content}`;
      }

      return this.outbound.sendText({ content });
    },
  };

  // 入站适配器（接收消息）
  inbound: ChannelInboundAdapter = {
    onMessage: (callback) => {
      // 监听 OpenClaw 插件的消息事件
      if (this.openclawPlugin.on) {
        this.openclawPlugin.on('message', (msg: any) => {
          // 转发消息到回调
          callback(msg);

          // 如果是命令，转发到 EventBridge
          if (msg.type === 'command' || msg.command) {
            const command = msg.command || msg.content;
            const args = msg.args || {};
            eventBridge.sendCommand(command, args, this.id);
          }
        });
      } else if (this.openclawPlugin.onMessage) {
        this.openclawPlugin.onMessage(callback);
      } else {
        console.warn(`[OpenClawAdapter] 插件 ${this.id} 没有实现消息接收方法`);
      }
    },
  };

  // 状态适配器
  status: ChannelStatusAdapter = {
    check: async () => {
      try {
        // 尝试调用插件的状态检查方法
        if (this.openclawPlugin.probe) {
          const result = await this.openclawPlugin.probe();
          return {
            healthy: result.success || result.connected,
            message: result.message || (result.success ? '已连接' : '未连接'),
          };
        } else if (this.openclawPlugin.isConnected) {
          const connected = await this.openclawPlugin.isConnected();
          return {
            healthy: connected,
            message: connected ? '已连接' : '未连接',
          };
        } else if (this.openclawPlugin.checkStatus) {
          const status = await this.openclawPlugin.checkStatus();
          return {
            healthy: status.healthy !== false,
            message: status.message || '状态未知',
          };
        }

        // 如果没有状态检查方法，检查配置是否有效
        const configValid = this.config.validate();
        return {
          healthy: configValid,
          message: configValid ? '配置有效' : '配置无效',
        };
      } catch (error: any) {
        return {
          healthy: false,
          message: `状态检查失败: ${error.message}`,
        };
      }
    },
  };

  // 设置适配器
  setup: ChannelSetupAdapter = {
    initialize: async () => {
      console.log(`[OpenClawAdapter] 初始化插件: ${this.id}`);

      // 调用插件的初始化方法
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      } else if (this.openclawPlugin.init) {
        await this.openclawPlugin.init();
      } else if (this.openclawPlugin.setup) {
        await this.openclawPlugin.setup();
      }

      // 订阅任务完成事件，转发到插件
      eventBridge.onTaskComplete((event) => {
        const message = event.error
          ? `❌ 任务失败\n任务: ${event.taskId}\n错误: ${event.error}`
          : `✅ 任务完成\n任务: ${event.taskId}`;

        this.outbound.sendText({ content: message }).catch((error) => {
          console.error(`[OpenClawAdapter] 发送任务通知失败:`, error);
        });
      });

      console.log(`[OpenClawAdapter] 插件 ${this.id} 初始化完成`);
    },

    cleanup: async () => {
      console.log(`[OpenClawAdapter] 清理插件: ${this.id}`);

      // 调用插件的清理方法
      if (this.openclawPlugin.cleanup) {
        await this.openclawPlugin.cleanup();
      } else if (this.openclawPlugin.destroy) {
        await this.openclawPlugin.destroy();
      } else if (this.openclawPlugin.close) {
        await this.openclawPlugin.close();
      }

      console.log(`[OpenClawAdapter] 插件 ${this.id} 清理完成`);
    },
  };
}

/**
 * 创建 OpenClaw 插件适配器
 */
export function createOpenClawAdapter(
  openclawPlugin: any,
  pluginId?: string
): OpenClawChannelAdapter {
  return new OpenClawChannelAdapter(openclawPlugin, pluginId);
}
