type AbortConversationAPI = {
  abortConversation: (conversationId: string) => boolean;
};

export function attachRequestAbortHandler(
  signal: AbortSignal,
  taskAPI: AbortConversationAPI,
  conversationId: string
): () => void {
  const onAbort = () => {
    taskAPI.abortConversation(conversationId);
  };
  signal.addEventListener('abort', onAbort);
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

export function cancelStreamForConversation(
  taskAPI: AbortConversationAPI,
  conversationId: string
): boolean {
  return taskAPI.abortConversation(conversationId);
}
