import type { TaskAPI } from '../../api/task-api';
import type { EventBridge } from '../bridge/event-bridge';
import type { ChannelCapabilities } from '../types';

/**
 * 动态 import 扩展时传入的宿主上下文（主进程 bundle 与扩展 bundle 非同一模块图时必须注入）。
 */
export type ChannelExtensionFactoryContext = {
  /** 与各渠道 squid-bridge 共用的唯一 EventBridge；扩展内勿仅依赖对 event-bridge 的静态 import */
  eventBridge: EventBridge;
  /** 宿主 TaskAPI；需要入站→Task 的扩展在 `setup.initialize` 内自行 `registerXxxSquidBridge(taskAPI)`，宿主无需逐渠道 import */
  taskAPI?: TaskAPI;
};

/** 渠道页「声明式」配置表单字段（由宿主按描述渲染，数据写入 ~/.squid/{userConfigFile}） */
export type ChannelWebConfigFieldType = 'text' | 'password' | 'textarea' | 'select' | 'json';

export interface ChannelWebConfigField {
  key: string;
  label: string;
  type: ChannelWebConfigFieldType;
  /** 为 true 时 GET 仅返回 hasXxx，POST 空字符串表示不修改原值 */
  optional?: boolean;
  secret?: boolean;
  placeholder?: string;
  /** type 为 select 时必填 */
  options?: { value: string; label: string }[];
}

export interface ChannelWebConfigForm {
  /** 仅允许安全文件名，实际路径 ~/.squid/<userConfigFile> */
  userConfigFile: string;
  intro?: string;
  fields: ChannelWebConfigField[];
}

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
  /** 可选：声明 Web 配置表单，宿主提供通用 GET/POST /api/channels/extension-config */
  configForm?: ChannelWebConfigForm;
}

export interface ChannelExtensionsFileConfig {
  /** 包含多个插件子目录的父路径 */
  roots?: string[];
  /**
   * 显式写出时：仅加载列表中的扩展 id（可配合 UI「启用」开关）。
   * 若项目与用户配置均未包含 `enabled` 键，则视为未启用白名单，扫描到的扩展均可加载（兼容旧配置）。
   */
  enabled?: string[] | null;
}

/** 扫描发现的扩展（未 import，仅 manifest） */
export interface DiscoveredChannelExtension {
  id: string;
  name: string;
  version: string;
}

/** 渠道页展示的扩展目录项 */
export interface ChannelExtensionCatalogEntry extends DiscoveredChannelExtension {
  /** 在白名单中视为启用（未启用白名单时为 true） */
  configEnabled: boolean;
  /** 当前进程是否已动态加载 */
  loaded: boolean;
}

/** 合并后的 channel-extensions 运行时视图 */
export interface MergedChannelExtensionsRuntime {
  roots: string[];
  enabled?: string[];
  /** 配置里是否显式出现过 enabled 键（决定是否为白名单模式） */
  enabledExplicit: boolean;
}

export interface ChannelExtensionLoadError {
  pluginId?: string;
  path?: string;
  message: string;
}
