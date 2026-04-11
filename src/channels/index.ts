import type { TaskAPI } from '../api/task-api';
import { ChannelRegistry } from './registry';
import { WebUIChannelPlugin } from './plugins/webui/plugin';
import {
  discoverChannelExtensions,
  getChannelExtensionLoadErrors,
  getExtensionChannelPluginIds,
  loadChannelExtensions as loadChannelExtensionsFromDisk,
  unloadChannelExtensions,
} from './extensions/loader';
import { hasExtensionAuthPending } from './extension-web-auth';

/**
 * 全局 Channel Registry 实例
 */
export const channelRegistry = new ChannelRegistry();

/** 供 `reloadChannelExtensions` 在未显式传入 TaskAPI 时使用（由 initializeBuiltinChannels 设置） */
let channelHostTaskAPI: TaskAPI | undefined;

/**
 * 初始化内置 channel 插件并加载扩展。
 * @param taskAPI 传入后注入扩展工厂；扩展在 setup 内自行注册 squid-bridge，宿主无需逐渠道 import。
 */
export async function initializeBuiltinChannels(taskAPI: TaskAPI): Promise<void> {
  channelHostTaskAPI = taskAPI;

  // 注册 WebUI Channel
  const webuiPlugin = new WebUIChannelPlugin();
  channelRegistry.register(webuiPlugin);

  // Initialize plugin
  if (webuiPlugin.setup) {
    await webuiPlugin.setup.initialize();
  }

  console.log('[Channels] Built-in channel plugins initialized');

  await loadChannelExtensionsFromDisk(channelRegistry, taskAPI);
}

/** 热重载扩展；`taskAPI` 可省略（使用最近一次 `initializeBuiltinChannels` 传入的实例） */
export async function reloadChannelExtensions(
  registry: ChannelRegistry,
  taskAPI?: TaskAPI
): Promise<void> {
  if (hasExtensionAuthPending()) {
    console.warn(
      '[ChannelExtensions] Active auth session detected in config page. Skip hot reload to avoid breaking polling. Reload after auth completes or fails.'
    );
    return;
  }
  const api = taskAPI ?? channelHostTaskAPI;
  if (!api) {
    console.warn(
      '[Channels] reloadChannelExtensions: missing TaskAPI, extensions cannot register squid-bridge (initializeBuiltinChannels(taskAPI) first or pass taskAPI)'
    );
  }
  await loadChannelExtensionsFromDisk(registry, api);
}

/**
 * Cleanup all channel plugins
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
            setTimeout(() => rej(new Error('cleanup timeout')), EXTENSION_CLEANUP_TIMEOUT_MS)
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
  console.log('[Channels] All channel plugins cleaned up');
}

export { getChannelsOverview } from './channel-overview';
export {
  loadChannelExtensionsConfigMerged,
  saveUserChannelExtensionsEnabled,
} from './extensions/config';
export { discoverChannelExtensions, getChannelExtensionLoadErrors, getExtensionChannelPluginIds, unloadChannelExtensions };
export { FeishuChannelPlugin, handleFeishuWebhookRequest, registerFeishuSquidBridge } from './feishu';
export { registerTelegramSquidBridge, TelegramChannelPlugin } from './telegram';
