# 更新履歴

## 2026-04-10

### 追加

- チャネル入站画像の認識：Telegram / Feishu / WeChat 個人アカウントで、認識可能な画像をワークスペースに保存し、`mentions(file)` 経由でタスク実行に注入。
- チャネル割り込みコマンド：`/wtf` を追加。`TaskAPI.executeTaskStream` のコマンド分岐に統一して中断をトリガー。

### 挙動の変更

- `/wtf` を Web の ESC と同義に整理：実行中のタスクのみ中断し、キューはクリアしない。
- `/wtf` の判定を busy チェックより前に実行し、セッションが忙しいときでも通常メッセージとして誤判定されないようにした。

### 検証

- `task-api-execute-stream-slash`、`telegram-squid-bridge`、`feishu-squid-bridge`、`weixin-personal-squid-bridge` の回帰テストを実施。
