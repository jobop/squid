import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import type { ChannelPlugin } from '../../src/channels/types';

/**
 * Example channel extension: after registration it appears as an extension source in Channels.
 * Enable it by setting "roots": ["extensions"] in config/channel-extensions.json
 * or ~/.squid/channel-extensions.json (relative to the squid repository root), then restart.
 */
export default async function createChannelPlugin(
  _ctx?: ChannelExtensionFactoryContext
): Promise<ChannelPlugin> {
  return {
    id: 'echo-demo',
    meta: {
      name: 'Echo Demo (Sample Extension)',
      description: 'OpenSpec channel-plugins-discovery-sandbox sample; no real messaging capability',
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
      check: async () => ({ healthy: true, message: 'Sample extension loaded' }),
    },
  };
}
