# Очередь команд (выровнено с claude-code-main)

## Кратко о поведении

- **Корзина по `conversationId`**: внутри одного диалога — очередь и приоритет (`now` > `next` > `later`); разные диалоги не блокируют друг друга.
- **Прямой запуск в простое**: `TaskAPI.executeTask` / `executeTaskStream` выполняются сразу, если сессия свободна.
- **При занятости — в очередь**: если в сессии уже идёт выполнение, новый запрос через `TaskAPIConversationBusyError` (stream) или `executeTask` с `queued: true` (не‑stream, 202) попадает в очередь; `enqueueFromRequest` вызывает `scheduleDrain`.
- **Цепочка drain**: после каждого `finally` вызывается `processConversationQueueIfReady`, пока в очереди сессии есть работа.

## HTTP

- `POST /api/task/execute`: при постановке в очередь — **HTTP 202**, тело с `queued`, `queuePosition`, `conversationId`.
- `POST /api/task/execute-stream`: при очереди по-прежнему **200 + SSE**, первый JSON в data с `queued: true`, `queuePosition`, `conversationId`, `message`; затем `[DONE]`. Фронт: обработка `parsed.queued` в `public/index.html`.

## Cron

- При срабатывании только `enqueuePendingNotification` в `conversationId = cron:<taskId>`; `cronManager.setEnqueueDrainNotifier` вызывает `taskAPI.kickConversationQueueDrain` для запуска drain; **прямой** `executeTask` из cron больше не используется.

## Внешние каналы (Feishu / Telegram / будущие)

- В meta `enqueueFromRequest` можно передать **`channelReply: { channelId, chatId }`** (общее поле ядра; не добавляйте отдельные поля канала в `QueuedCommand`).
- После выполнения из очереди TaskAPI рассылает всем обработчикам **`addChannelQueuedCompleteHandler`**; в мосте канала проверяйте `cmd.channelReply?.channelId === '<id>'` перед отправкой ответа.
- **Обратная совместимость**: meta по-прежнему может содержать устаревший `feishuChatId` (эквивалент `channelReply: { channelId: 'feishu', chatId }`).

## Команда прерывания канала (`/wtf`)

- `/wtf` обрабатывается централизованно в `TaskAPI.executeTaskStream` (отдельные ветки в каналах не нужны).
- Семантика как у Web ESC: только `abortConversation(conversationId)` для текущей задачи, очередь не очищается.
- Проверка `/wtf` выполняется **до** busy, поэтому при «идёт задача» прерывание срабатывает сразу, без преждевременного busy.

## Feishu

- Мост использует `channelId: 'feishu'` и общий механизм, описанный выше.
