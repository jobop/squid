# 命令队列（与 claude-code-main 对齐）

## 行为摘要

- **按 `conversationId` 分桶**：同一对话内排队与优先级（`now` > `next` > `later`），不同对话互不阻塞。
- **空闲直连**：`TaskAPI.executeTask` / `executeTaskStream` 在会话未占用时直接执行。
- **忙则入队**：同会话已有执行中时，新请求通过 `TaskAPIConversationBusyError`（流式）或 `executeTask` 返回 `queued: true`（非流式 202）进入队列；`enqueueFromRequest` 会触发 `scheduleDrain`。
- **链式 drain**：每次执行在 `finally` 中调用 `processConversationQueueIfReady`，自动跑完该会话队列。

## HTTP

- `POST /api/task/execute`：若排队则 **HTTP 202**，body 含 `queued`, `queuePosition`, `conversationId`。
- `POST /api/task/execute-stream`：若排队则仍为 **200 + SSE**，首条 data JSON 含 `queued: true`, `queuePosition`, `conversationId`, `message`；随后 `[DONE]`。前端见 `public/index.html` 对 `parsed.queued` 的处理。

## Cron

- 触发时仅 `enqueuePendingNotification` 到 `conversationId = cron:<taskId>`，由 `cronManager.setEnqueueDrainNotifier` 调用 `taskAPI.kickConversationQueueDrain` 启动 drain；不再在 cron 内直接调用 `executeTask`。

## 飞书

- 会话忙时 `enqueueFromRequest`（`feishuChatId` 用于回贴），并提示用户已排队；执行完成后由 `setChannelQueuedCompleteHandler` 发回助手正文。
