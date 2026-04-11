import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import { TelegramChannelPlugin } from './src/plugin';

export default async function createChannelPlugin(ctx?: ChannelExtensionFactoryContext) {
  if (!ctx?.eventBridge) {
    throw new Error('Channel extension requires host-injected eventBridge (cannot resolve event-bridge from ../../src after packaging)');
  }
  return new TelegramChannelPlugin(ctx.eventBridge, ctx.taskAPI);
}
