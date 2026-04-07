import type { ChannelExtensionFactoryContext } from '../../src/channels/extensions/types';
import { loadFeishuChannelConfig, validateFeishuChannelConfig } from './src/config-store';
import { bindFeishuExtensionEventBridge } from './src/feishu-host-bridge';
import { FeishuChannelPlugin } from './src/plugin';

/** 仅需 appId+appSecret；defaultReceiveId 可选（出站可回退为最近入站 chat_id） */
export default async function createChannelPlugin(ctx?: ChannelExtensionFactoryContext) {
  if (!ctx?.eventBridge) {
    throw new Error('渠道扩展须由宿主注入 eventBridge（打包后无法从 ../../src 解析 event-bridge）');
  }
  bindFeishuExtensionEventBridge(ctx.eventBridge);
  const cfg = await loadFeishuChannelConfig();
  if (!cfg || !validateFeishuChannelConfig(cfg).ok) {
    throw new Error('飞书配置不完整，跳过注册（需 ~/.squid/feishu-channel.json 中 appId、appSecret）');
  }
  return new FeishuChannelPlugin(ctx?.taskAPI);
}
