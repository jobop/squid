import type { EventBridge } from '../../../src/channels/bridge/event-bridge';
import { eventBridge as bundledFallback } from '../../../src/channels/bridge/event-bridge';

/** 由 extension-entry 在加载时绑定为主进程传入的实例；未绑定时回退到扩展包内 import（单测/同源 bundle） */
let hostEventBridge: EventBridge | null = null;

export function bindFeishuExtensionEventBridge(bridge: EventBridge): void {
  hostEventBridge = bridge;
}

export function getFeishuExtensionEventBridge(): EventBridge {
  return hostEventBridge ?? bundledFallback;
}
