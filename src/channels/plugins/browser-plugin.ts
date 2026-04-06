// Browser Channel Plugin - 浏览器系统通知插件
import type {
  ChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelOutboundAdapter,
  ChannelStatusAdapter,
  ChannelSetupAdapter,
  NotificationMessage,
  NotificationResult
} from '../types';

/**
 * 浏览器系统通知插件
 *
 * 使用浏览器 Notification API 发送系统级通知
 */
export class BrowserChannelPlugin implements ChannelPlugin {
  id = 'browser';

  meta: ChannelMeta = {
    name: '浏览器通知',
    description: '浏览器系统级通知',
    category: 'builtin'
  };

  capabilities: ChannelCapabilities = {
    outbound: {
      text: true,
      media: false,
      rich: false,
      streaming: false
    },
    inbound: {
      text: false,
      commands: false,
      interactive: false
    }
  };

  private permissionGranted = false;

  config: ChannelConfigAdapter = {
    get: () => undefined,
    set: () => {},
    getAll: () => ({}),
    validate: () => true
  };

  outbound: ChannelOutboundAdapter = {
    sendText: async (params) => {
      return this.sendBrowserNotification(params.title || 'Notification', params.content);
    },

    sendNotification: async (message: NotificationMessage) => {
      return this.sendBrowserNotification(message.title, message.content, message.type);
    }
  };

  status: ChannelStatusAdapter = {
    check: async () => {
      if (typeof Notification === 'undefined') {
        return {
          healthy: false,
          message: 'Notification API not available (not in browser environment)'
        };
      }

      if (Notification.permission === 'denied') {
        return {
          healthy: false,
          message: 'Notification permission denied by user'
        };
      }

      if (Notification.permission === 'default') {
        return {
          healthy: true,
          message: 'Notification permission not requested yet'
        };
      }

      return {
        healthy: true,
        message: 'Notification permission granted'
      };
    }
  };

  setup: ChannelSetupAdapter = {
    initialize: async () => {
      if (typeof Notification === 'undefined') {
        console.warn('[BrowserChannel] Notification API not available');
        return;
      }

      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        this.permissionGranted = permission === 'granted';
        console.log(`[BrowserChannel] Permission ${permission}`);
      } else {
        this.permissionGranted = Notification.permission === 'granted';
      }
    },

    cleanup: async () => {
      // No cleanup needed for browser notifications
    }
  };

  private async sendBrowserNotification(
    title: string,
    body: string,
    type?: string
  ): Promise<NotificationResult> {
    if (typeof Notification === 'undefined') {
      return {
        success: false,
        error: 'Notification API not available'
      };
    }

    if (Notification.permission !== 'granted') {
      return {
        success: false,
        error: `Notification permission ${Notification.permission}`
      };
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: this.getTypeIcon(type),
        badge: '/icon.png',
        tag: 'squid-notification',
        requireInteraction: false
      });

      // 自动关闭
      setTimeout(() => notification.close(), 5000);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private getTypeIcon(type?: string): string {
    // 可以根据类型返回不同的图标
    return '/icon.png';
  }
}
