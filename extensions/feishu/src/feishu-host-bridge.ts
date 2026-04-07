import type { EventBridge } from '../../../src/channels/bridge/event-bridge';

/** 与 `src/channels/bridge/event-bridge.ts` 一致；扩展内不能 import 该模块时值回退用 */
const EVENT_BRIDGE_GLOBAL_KEY = '__SQUID_CHANNEL_EVENT_BRIDGE__';

function getEventBridgeFromGlobalThis(): EventBridge | null {
  const g = globalThis as Record<string, unknown>;
  const existing = g[EVENT_BRIDGE_GLOBAL_KEY];
  if (
    existing != null &&
    typeof (existing as { emitChannelInbound?: unknown }).emitChannelInbound === 'function'
  ) {
    return existing as EventBridge;
  }
  return null;
}

/** 由 extension-entry 在加载时绑定宿主传入的 EventBridge（与 globalThis 单例应为同一引用） */
let hostEventBridge: EventBridge | null = null;

export function bindFeishuExtensionEventBridge(bridge: EventBridge): void {
  hostEventBridge = bridge;
}

export function getFeishuExtensionEventBridge(): EventBridge {
  if (hostEventBridge) {
    return hostEventBridge;
  }
  const fromGlobal = getEventBridgeFromGlobalThis();
  if (fromGlobal) {
    return fromGlobal;
  }
  throw new Error(
    'Feishu: 无可用 EventBridge（宿主须已初始化 channel 总线，且扩展入口应传入并 bind ctx.eventBridge）'
  );
}
