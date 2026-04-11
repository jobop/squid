# コマンドキュー（claude-code-main との整合）

## 挙動の要約

- **`conversationId` ごとのバケット**：同一会話内でキューイングと優先度（`now` > `next` > `later`）。会話間は相互にブロックしない。  
- **アイドル時は直行**：`TaskAPI.executeTask` / `executeTaskStream` は、会話が占有されていないときはそのまま実行。  
- **ビジーならキューへ**：同一会話で既に実行中のとき、新規リクエストは `TaskAPIConversationBusyError`（ストリーム）または `executeTask` が `queued: true`（非ストリーム 202）でキューへ。`enqueueFromRequest` が `scheduleDrain` を起動。  
- **チェーン drain**：各実行の `finally` で `processConversationQueueIfReady` を呼び、その会話のキューを最後まで処理。

## HTTP

- `POST /api/task/execute`：キューに入った場合 **HTTP 202**、本文に `queued`, `queuePosition`, `conversationId`。  
- `POST /api/task/execute-stream`：キュー時も **200 + SSE**、最初の data JSON に `queued: true`, `queuePosition`, `conversationId`, `message` のあと `[DONE]`。フロントは `public/index.html` の `parsed.queued` 処理を参照。

## Cron

- トリガー時は `conversationId = cron:<taskId>` へ `enqueuePendingNotification` のみ。`cronManager.setEnqueueDrainNotifier` から `taskAPI.kickConversationQueueDrain` を呼び drain を起動。Cron 内から直接 `executeTask` は呼ばない。

## 外部チャネル（Feishu / Telegram / 今後の拡張）

- 会話がビジーなとき、`enqueueFromRequest` の meta に **`channelReply: { channelId, chatId }`** を付与（コアフィールド。単一チャネル向けに `QueuedCommand` を増やさない）。  
- キュー実行完了後、TaskAPI は **`addChannelQueuedCompleteHandler`** に登録されたコールバックへブロードキャスト。各チャネルブリッジで `cmd.channelReply?.channelId === '<id>'` のときだけ返信。  
- **互換**：meta は非推奨の `feishuChatId` もサポート（`channelReply: { channelId: 'feishu', chatId }` と同等）。

## チャネル割り込みコマンド（`/wtf`）

- `/wtf` は `TaskAPI.executeTaskStream` で統一処理（各チャネルに個別の中断分岐は不要）。  
- Web ESC と同義：`abortConversation(conversationId)` のみ呼び、キュー済み項目はクリアしない。  
- `/wtf` のチェックは busy 判定より前。会話が「実行中」でも即座に中断でき、先に busy として弾かれない。

## Feishu

- ブリッジは `channelId: 'feishu'` で上記の汎用機構と一致。
