import type { ChannelPlugin } from './types';
import type { ChannelRegistry } from './registry';
import {
  loadFeishuChannelConfigSync,
  validateFeishuChannelConfig,
  validateFeishuOutboundConfig,
} from './feishu';
import { getExtensionWebConfigurableChannelIds } from './extension-web-config';

const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

export interface ChannelOverviewDTO {
  id: string;
  name: string;
  description: string;
  healthy: boolean;
  statusMessage: string;
  category: string;
  configurable: boolean;
  /** 是否在 channelRegistry 中已注册并初始化 */
  registered: boolean;
  /** 内置或动态加载的扩展 */
  source: 'builtin' | 'extension';
}

/**
 * 对单个插件执行 status.check，超时则视为不健康（供 UI 列表与单测使用）。
 */
export async function checkChannelStatus(
  plugin: Pick<ChannelPlugin, 'status'>,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS
): Promise<{ healthy: boolean; message: string }> {
  const run = plugin.status.check().then((r) => ({
    healthy: r.healthy,
    message: (r.message && r.message.trim()) || (r.healthy ? '正常' : '异常'),
  }));
  const timeout = new Promise<{ healthy: boolean; message: string }>((resolve) => {
    setTimeout(
      () => resolve({ healthy: false, message: '状态检查超时' }),
      timeoutMs
    );
  });
  try {
    return await Promise.race([run, timeout]);
  } catch (e: any) {
    return { healthy: false, message: e?.message || String(e) };
  }
}

function pluginToOverview(
  plugin: ChannelPlugin,
  healthy: boolean,
  statusMessage: string,
  source: 'builtin' | 'extension',
  extensionWebConfigurableIds: ReadonlySet<string>
): ChannelOverviewDTO {
  return {
    id: plugin.id,
    name: plugin.meta.name,
    description: plugin.meta.description,
    healthy,
    statusMessage,
    category: plugin.meta.category,
    configurable: extensionWebConfigurableIds.has(plugin.id),
    registered: true,
    source,
  };
}

function syntheticFeishuOverview(): ChannelOverviewDTO {
  const cfg = loadFeishuChannelConfigSync();
  if (!cfg?.appId?.trim()) {
    return {
      id: 'feishu',
      name: 'Feishu / Lark',
      description: '飞书机器人（默认 WebSocket 长连接入站 + tenant 发消息）',
      healthy: false,
      statusMessage: '未配置：请填写 App ID 等信息后保存；若已启用飞书扩展，保存后会自动重新加载扩展。',
      category: 'builtin',
      configurable: true,
      registered: false,
      source: 'builtin',
    };
  }
  const base = validateFeishuChannelConfig(cfg);
  if (!base.ok) {
    return {
      id: 'feishu',
      name: 'Feishu / Lark',
      description: '飞书机器人（默认 WebSocket 长连接入站 + tenant 发消息）',
      healthy: false,
      statusMessage: base.errors.join('; '),
      category: 'builtin',
      configurable: true,
      registered: false,
      source: 'builtin',
    };
  }
  const out = validateFeishuOutboundConfig(cfg);
  if (!out.ok) {
    return {
      id: 'feishu',
      name: 'Feishu / Lark',
      description: '飞书机器人（默认 WebSocket 长连接入站 + tenant 发消息）',
      healthy: false,
      statusMessage:
        '入站凭证已有；未填默认接收方时，主动消息会回退为「最近入站会话」的 chat_id。若扩展未加载，请在渠道页检查「扩展启用」或 channel-extensions.json。',
      category: 'builtin',
      configurable: true,
      registered: false,
      source: 'builtin',
    };
  }
  return {
    id: 'feishu',
    name: 'Feishu / Lark',
    description: '飞书机器人（默认 WebSocket 长连接入站 + tenant 发消息）',
    healthy: false,
    statusMessage:
      '配置已完整但未在当前进程注册：请在渠道页勾选启用飞书扩展并保存，或保存飞书凭证以触发自动重新加载。',
    category: 'builtin',
    configurable: true,
    registered: false,
    source: 'builtin',
  };
}

/**
 * Channel 管理 UI 使用的聚合列表：已注册插件走 status.check；未注册飞书则提供占位行（仍可打开配置页）。
 * @param extensionPluginIds 动态扩展注册的 id 集合（其余视为内置）
 */
export async function getChannelsOverview(
  registry: ChannelRegistry,
  extensionPluginIds: ReadonlySet<string> = new Set()
): Promise<ChannelOverviewDTO[]> {
  const extensionWebConfigurableIds = getExtensionWebConfigurableChannelIds();
  const plugins = registry.list();
  const rows = await Promise.all(
    plugins.map(async (plugin) => {
      const { healthy, message } = await checkChannelStatus(plugin);
      const source = extensionPluginIds.has(plugin.id) ? 'extension' : 'builtin';
      return pluginToOverview(plugin, healthy, message, source, extensionWebConfigurableIds);
    })
  );
  const out = [...rows];
  if (!plugins.some((p) => p.id === 'feishu')) {
    out.push(syntheticFeishuOverview());
  }
  return out;
}
