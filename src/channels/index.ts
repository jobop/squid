import { ChannelRegistry } from './registry';
import { WebUIChannelPlugin } from './plugins/webui/plugin';
import {
  getExtensionChannelPluginIds,
  loadChannelExtensions,
} from './extensions/loader';

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

  console.log('[Channels] 内置 channel 插件初始化完成');

  await loadChannelExtensions(channelRegistry);
}

/**
 * 清理所有 channel 插件
 */
const EXTENSION_CLEANUP_TIMEOUT_MS = 5000;

export async function cleanupChannels(): Promise<void> {
  const plugins = channelRegistry.list();
  const extIds = getExtensionChannelPluginIds();

  for (const plugin of plugins) {
    if (!plugin.setup?.cleanup) continue;
    try {
      if (extIds.has(plugin.id)) {
        await Promise.race([
          plugin.setup.cleanup(),
          new Promise<void>((_, rej) =>
            setTimeout(() => rej(new Error('cleanup 超时')), EXTENSION_CLEANUP_TIMEOUT_MS)
          ),
        ]);
      } else {
        await plugin.setup.cleanup();
      }
    } catch (e: any) {
      console.error(`[Channels] cleanup ${plugin.id}:`, e?.message || e);
    }
  }

  channelRegistry.clear();
  console.log('[Channels] 所有 channel 插件已清理');
}

export { getChannelsOverview } from './channel-overview';
export { getChannelExtensionLoadErrors, getExtensionChannelPluginIds } from './extensions/loader';
export { FeishuChannelPlugin, handleFeishuWebhookRequest, registerFeishuSquidBridge } from './feishu';
