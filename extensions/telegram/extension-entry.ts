import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import { TelegramChannelPlugin } from './src/plugin';

export default async function createChannelPlugin(ctx?: ChannelExtensionFactoryContext) {
  if (!ctx?.eventBridge) {
    throw new Error('渠道扩展须由宿主注入 eventBridge（打包后无法从 ../../src 解析 event-bridge）');
  }
  return new TelegramChannelPlugin(ctx.eventBridge, ctx.taskAPI);
}
