# Command queue (aligned with claude-code-main)

## Behavior summary

- **Bucketed by `conversationId`**: per-conversation queueing and priority (`now` > `next` > `later`); different conversations do not block each other.
- **Fast path when idle**: `TaskAPI.executeTask` / `executeTaskStream` run immediately if the session is free.
- **Enqueue when busy**: if a session already has work in flight, new requests go through `TaskAPIConversationBusyError` (streaming) or `executeTask` returns `queued: true` (non-streaming HTTP 202); `enqueueFromRequest` triggers `scheduleDrain`.
- **Chained drain**: each run’s `finally` calls `processConversationQueueIfReady` to drain that session’s queue.

## HTTP

- `POST /api/task/execute`: when queued, responds **HTTP 202** with `queued`, `queuePosition`, `conversationId` in the body.
- `POST /api/task/execute-stream`: still **200 + SSE** when queued; first `data` JSON includes `queued: true`, `queuePosition`, `conversationId`, `message`; then `[DONE]`. Front-end handling for `parsed.queued` lives in `public/index.html`.

## Cron

- Triggers only `enqueuePendingNotification` to `conversationId = cron:<taskId>`; `cronManager.setEnqueueDrainNotifier` calls `taskAPI.kickConversationQueueDrain` to start draining—cron no longer calls `executeTask` directly.

## External channels (Feishu / Telegram / future extensions)

- When busy, `enqueueFromRequest` metadata may include **`channelReply: { channelId, chatId }`** (core fields—do not add per-channel `QueuedCommand` variants).
- After a queued item runs, TaskAPI broadcasts to all **`addChannelQueuedCompleteHandler`** callbacks; each bridge checks `cmd.channelReply?.channelId === '<id>'` before replying.
- **Compatibility**: metadata still accepts deprecated `feishuChatId` (equivalent to `channelReply: { channelId: 'feishu', chatId }`).

## Channel interrupt (`/wtf`)

- Handled centrally in `TaskAPI.executeTaskStream` (channels do not implement their own interrupt branches).
- Same semantics as Web ESC: call `abortConversation(conversationId)` for the in-flight task only; queued items remain.
- `/wtf` is evaluated **before** the busy gate so a running session can still interrupt immediately instead of receiving a busy response first.

## Feishu

- The bridge uses `channelId: 'feishu'` with the same generic mechanism as above.
