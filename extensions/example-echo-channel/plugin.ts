import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import type { ChannelPlugin } from '../../src/channels/types';

/**
 * 示例 Channel 扩展：注册后可在「渠道」页看到来源为「扩展」。
 * 启用方式：在 config/channel-extensions.json 或 ~/.squid/channel-extensions.json 中设置
 * "roots": ["extensions"]（相对 jobopx-desktop 根目录）并重启。
 */
export default async function createChannelPlugin(
  _ctx?: ChannelExtensionFactoryContext
): Promise<ChannelPlugin> {
  return {
    id: 'echo-demo',
    meta: {
      name: 'Echo Demo（示例扩展）',
      description: 'OpenSpec channel-plugins-discovery-sandbox 示例；无实际消息能力',
      category: 'third-party',
    },
    capabilities: {
      outbound: { text: true, media: false, rich: false, streaming: false },
      inbound: { text: false, commands: false, interactive: false },
    },
    config: {
      get: () => undefined,
      set: () => {},
      getAll: () => ({}),
      validate: () => true,
    },
    outbound: {
      sendText: async () => ({ success: true }),
      sendNotification: async () => ({ success: true }),
    },
    status: {
      check: async () => ({ healthy: true, message: '示例扩展已加载' }),
    },
  };
}
