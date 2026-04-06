import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import { loadFeishuChannelConfig, validateFeishuChannelConfig } from './src/config-store';
import { bindFeishuExtensionEventBridge } from './src/feishu-host-bridge';
import { FeishuChannelPlugin } from './src/plugin';

/** 仅需 appId+appSecret；defaultReceiveId 可选（出站可回退为最近入站 chat_id） */
export default async function createChannelPlugin(ctx?: ChannelExtensionFactoryContext) {
  if (ctx?.eventBridge) {
    bindFeishuExtensionEventBridge(ctx.eventBridge);
  }
  const cfg = await loadFeishuChannelConfig();
  if (!cfg || !validateFeishuChannelConfig(cfg).ok) {
    throw new Error('飞书配置不完整，跳过注册（需 ~/.squid/feishu-channel.json 中 appId、appSecret）');
  }
  return new FeishuChannelPlugin();
}
