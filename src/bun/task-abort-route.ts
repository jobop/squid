type AbortTaskRequestBody = {
  conversationId?: unknown;
};

type AbortTaskAPI = {
  abortConversation: (conversationId: string) => boolean;
};

export type AbortTaskRouteResult = {
  status: number;
  payload: {
    success: boolean;
    aborted?: boolean;
    conversationId?: string;
    error?: string;
  };
};

export function handleAbortTaskRoute(
  taskAPI: AbortTaskAPI,
  body: AbortTaskRequestBody
): AbortTaskRouteResult {
  const conversationId = String(body?.conversationId || '').trim();
  if (!conversationId) {
    return {
      status: 400,
      payload: {
        success: false,
        error: 'conversationId is required',
      },
    };
  }

  const aborted = taskAPI.abortConversation(conversationId);
  return {
    status: 200,
    payload: {
      success: true,
      aborted,
      conversationId,
    },
  };
}
