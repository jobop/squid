import type { EventBridge } from '../bridge/event-bridge';
import type { ChannelCapabilities } from '../types';

/**
 * 动态 import 扩展时传入的宿主上下文（主进程 bundle 与扩展 bundle 非同一模块图时必须注入）。
 */
export type ChannelExtensionFactoryContext = {
  /** 与 registerFeishuSquidBridge 等共用的唯一 EventBridge；扩展内勿仅依赖对 event-bridge 的静态 import */
  eventBridge: EventBridge;
};

/** 根目录下子文件夹内的 channel-plugin.json */
export interface ChannelExtensionManifest {
  id: string;
  name: string;
  version: string;
  /** 相对插件根目录的 ESM 入口，如 ./plugin.ts */
  main: string;
  /** 可选：与 ChannelCapabilities 对齐的声明（用于校验提示，运行时以实例为准） */
  capabilities?: Partial<ChannelCapabilities>;
  /** 可选：预留权限声明（P0 不强制消费） */
  permissions?: string[];
}

export interface ChannelExtensionsFileConfig {
  /** 包含多个插件子目录的父路径 */
  roots?: string[];
  /**
   * 仅加载列出的 id；缺省或 null 表示不限制（发现即尝试加载）。
   * 空数组 [] 表示不加载任何扩展。
   */
  enabled?: string[] | null;
}

export interface ChannelExtensionLoadError {
  pluginId?: string;
  path?: string;
  message: string;
}
