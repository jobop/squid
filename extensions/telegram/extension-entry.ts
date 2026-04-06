import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import { eventBridge } from '../../src/channels/bridge/event-bridge';
import { TelegramChannelPlugin } from './src/plugin';

export default async function createChannelPlugin(ctx?: ChannelExtensionFactoryContext) {
  const bridge = ctx?.eventBridge ?? eventBridge;
  return new TelegramChannelPlugin(bridge, ctx?.taskAPI);
}
