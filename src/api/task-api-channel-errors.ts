/**
 * 供动态 import 的渠道扩展使用：无其它 squid 依赖，可单独打进 app 包（见 electrobun build.copy）。
 * 宿主 task-api 与此处须导出同一错误形态，以便 instanceof 失效时仍可用 isTaskAPIConversationBusyError 识别。
 */

/** 同会话已有执行中任务时抛出，由 HTTP / Channel 捕获并入队 */
export class TaskAPIConversationBusyError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`conversation busy: ${conversationId}`);
    this.name = 'TaskAPIConversationBusyError';
    this.conversationId = conversationId;
  }
}

export function isTaskAPIConversationBusyError(
  e: unknown
): e is TaskAPIConversationBusyError {
  if (e instanceof TaskAPIConversationBusyError) return true;
  // 动态 import 的扩展与宿主各有一份本模块时，instanceof 会失效；用 name + conversationId 识别
  if (e !== null && typeof e === 'object') {
    const o = e as { name?: unknown; conversationId?: unknown };
    if (
      o.name === 'TaskAPIConversationBusyError' &&
      typeof o.conversationId === 'string'
    ) {
      return true;
    }
  }
  return false;
}
