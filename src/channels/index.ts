import { ChannelRegistry } from './registry';
import { WebUIChannelPlugin } from './plugins/webui/plugin';
import { FeishuChannelPlugin } from './feishu/plugin';
import { loadFeishuChannelConfig, validateFeishuOutboundConfig } from './feishu/config-store';

/**
 * 全局 Channel Registry 实例
 */
export const channelRegistry = new ChannelRegistry();

/**
 * 初始化内置 channel 插件
 */
export async function initializeBuiltinChannels(): Promise<void> {
  // 注册 WebUI Channel
  const webuiPlugin = new WebUIChannelPlugin();
  channelRegistry.register(webuiPlugin);

  // 初始化插件
  if (webuiPlugin.setup) {
    await webuiPlugin.setup.initialize();
  }

  const feishuCfg = await loadFeishuChannelConfig();
  if (feishuCfg && validateFeishuOutboundConfig(feishuCfg).ok) {
    const feishuPlugin = new FeishuChannelPlugin();
    channelRegistry.register(feishuPlugin);
    if (feishuPlugin.setup) {
      await feishuPlugin.setup.initialize();
    }
    console.log('[Channels] 已注册 Feishu Channel（出站配置完整）');
  }

  console.log('[Channels] 内置 channel 插件初始化完成');
}

/**
 * 清理所有 channel 插件
 */
export async function cleanupChannels(): Promise<void> {
  const plugins = channelRegistry.list();

  for (const plugin of plugins) {
    if (plugin.setup) {
      await plugin.setup.cleanup();
    }
  }

  channelRegistry.clear();
  console.log('[Channels] 所有 channel 插件已清理');
}

export { getChannelsOverview } from './channel-overview';
export { FeishuChannelPlugin } from './feishu/plugin';
export { handleFeishuWebhookRequest } from './feishu/webhook-handler';
export { registerFeishuSquidBridge } from './feishu/squid-bridge';
