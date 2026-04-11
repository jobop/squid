# WebUI Channel 利用ガイド

## 概要

WebUI Channel は組み込みの channel プラグインで、チャット UI を標準 channel として扱い、WebSocket 経由で実行エンジンと双方向通信します。

アプリのサイドバー **「チャネル」** から WebUI を含む一覧とヘルスを確認できます。WebUI の詳細は読み取り専用の説明であり、Web から設定を書き換える入口はありません。

## 機能

- タスク完了通知のリアルタイム受信  
- チャットからのコマンド送信  
- WebSocket の自動再接続  
- ハートビートによる接続維持  
- 複数クライアントの同時接続  

## アーキテクチャ

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│  フロント   │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (ブラウザ)  │                           │   (バックエンド)  │
└─────────────┘                           └──────────────────┘
                                                    │
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │   実行エンジン    │
                                          │(CronManager/Tasks)│
                                          └──────────────────┘
```

## 設定

### サーバー側

`config/channels.json` で設定します。

```json
{
  "channels": {
    "webui": {
      "enabled": true,
      "port": 8080,
      "heartbeatInterval": 30000
    }
  }
}
```

**項目：**

- `enabled` — WebUI Channel を有効にするか  
- `port` — WebSocket サーバのポート（既定 8080）  
- `heartbeatInterval` — ハートビート間隔（ミリ秒。既定 30000）  

### フロント側

WebSocket クライアントは既定で `ws://localhost:8080` に接続します。

接続先を変える場合は `public/websocket-client.js` で次のように変更します。

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## 使い方

### 1. アプリの起動

WebUI Channel はアプリ起動時に自動初期化されます。

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### 2. タスク通知の受信

フロントは自動でタスク完了通知を受け取り、チャットに表示します。

```javascript
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### 3. コマンドの送信

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## メッセージ形式

### サーバー → クライアント

#### タスク完了通知

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "データ処理タスク",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

#### 一般通知

```json
{
  "type": "notification",
  "data": {
    "title": "システム通知",
    "content": "操作が成功しました",
    "type": "success"
  }
}
```

#### ハートビート

```json
{
  "type": "ping"
}
```

### クライアント → サーバー

#### コマンド送信

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

#### ハートビート応答

```json
{
  "type": "pong"
}
```

## API リファレンス

### WebSocketClient（フロント）

#### connect()

WebSocket サーバへ接続します。

```javascript
window.wsClient.connect();
```

#### disconnect()

接続を切ります。

```javascript
window.wsClient.disconnect();
```

#### send(type, data)

メッセージを送ります。

```javascript
window.wsClient.send('command', { command: 'test', args: {} });
```

#### sendCommand(command, args)

コマンド送信用のショートカットです。

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

#### on(type, handler)

ハンドラを登録します。

```javascript
window.wsClient.on('task:complete', (event) => {
  console.log('タスク完了:', event);
});
```

#### off(type, handler)

ハンドラを削除します。

```javascript
window.wsClient.off('task:complete', handler);
```

#### isConnected()

接続状態を返します。

```javascript
if (window.wsClient.isConnected()) {
  console.log('接続済み');
}
```

## トラブルシューティング

### 接続失敗

1. WebSocket サーバが起動しているか  
2. ポートが占有されていないか  
3. ブラウザコンソールのエラー  

### メッセージが届かない

1. WebSocket が接続されているか  
2. EventBridge からイベントが飛んでいるか  
3. サーバログ  

### 自動再接続が止まる

クライアントは指数バックオフで再接続します。

- 1 回目：1 秒後  
- 2 回目：2 秒後  
- 3 回目：4 秒後  
- …  
- 最大 10 回  

上限に達したらページを手動で再読み込みしてください。

## 例

### タスク通知の受信

```javascript
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `タスク失敗: ${event.error}`
    : `タスク完了: ${event.result}`;
  showNotification(message);
});

window.wsClient.on('connection', (data) => {
  if (data.connected) {
    console.log('WebSocket 接続済み');
  } else {
    console.log('WebSocket 切断');
  }
});
```

### コマンド送信

```javascript
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket が未接続です');
    return;
  }
  window.wsClient.sendCommand('restart-task', { taskId });
}

function cancelTask(taskId) {
  window.wsClient.sendCommand('cancel-task', { taskId });
}
```

## パフォーマンス

1. **メッセージのバッチ** — 大量送信時はバッチを検討  
2. **ハートビート間隔** — ネットワークに合わせて調整  
3. **接続プール** — 複数クライアントはサーバ側で自動管理  

## セキュリティ

1. **ローカル接続** — 現行は主に localhost  
2. **認証なし** — 開発向け。本番用途では認証を検討  
3. **メッセージ検証** — サーバが形式を検証  

## 今後の予定

- [ ] TLS/WSS のサポート  
- [ ] 認証の追加  
- [ ] リモート接続のサポート  
- [ ] メッセージ圧縮  
- [ ] オフライン向けメッセージキューの永続化  
