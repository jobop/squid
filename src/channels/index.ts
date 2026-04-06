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

  // 初始化插件
  if (webuiPlugin.setup) {
    await webuiPlugin.setup.initialize();
  }

  console.log('[Channels] 内置 channel 插件初始化完成');

  await loadChannelExtensionsFromDisk(channelRegistry, taskAPI);
}

/** 热重载扩展；`taskAPI` 可省略（使用最近一次 `initializeBuiltinChannels` 传入的实例） */
export async function reloadChannelExtensions(
  registry: ChannelRegistry,
  taskAPI?: TaskAPI
): Promise<void> {
  const api = taskAPI ?? channelHostTaskAPI;
  if (!api) {
    console.warn(
      '[Channels] reloadChannelExtensions: 无 TaskAPI，扩展将无法注册 squid-bridge（请先 initializeBuiltinChannels(taskAPI) 或传入 taskAPI）'
    );
  }
  await loadChannelExtensionsFromDisk(registry, api);
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
export {
  loadChannelExtensionsConfigMerged,
  saveUserChannelExtensionsEnabled,
} from './extensions/config';
export { discoverChannelExtensions, getChannelExtensionLoadErrors, getExtensionChannelPluginIds, unloadChannelExtensions };
export { FeishuChannelPlugin, handleFeishuWebhookRequest, registerFeishuSquidBridge } from './feishu';
export { registerTelegramSquidBridge, TelegramChannelPlugin } from './telegram';
