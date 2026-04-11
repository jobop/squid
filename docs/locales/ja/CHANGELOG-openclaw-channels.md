# OpenClaw 互換チャネル — 変更サマリー

## 概要

EventBridge に基づく双方向通信を実装し、実行エンジンとチャネルプラグイン（WebUI チャットおよび OpenClaw Feishu プラグインを含む）間でメッセージをやり取りできるようにしました。

## 実装した機能

### 1. EventBridge イベントバス

- Node.js EventEmitter ベースの軽量イベントバス
- タスク完了通知（`notifyTaskComplete`）をサポート
- コマンド送信（`sendCommand`）をサポート
- グローバルシングルトンで全モジュールが共有
- エラー分離：ある購読者の失敗が他に波及しない

**ファイル：**

- `src/channels/bridge/event-bridge.ts`

### 2. WebUI Channel プラグイン

- WebSocket サーバー（ポート 8080）
- 複数クライアント接続
- ハートビート（30 秒間隔）
- 自動再接続
- EventBridge イベントの購読と全クライアントへのブロードキャスト
- クライアントからのコマンド受信と EventBridge への転送

**ファイル：**

- `src/channels/plugins/webui/plugin.ts`
- `src/channels/registry.ts`
- `src/channels/index.ts`

### 3. フロントエンド WebSocket クライアント

- 自動接続と再接続（指数バックオフ）
- ハートビートの送受信
- タスク完了通知の UI 表示
- コマンド送信 API
- 接続状態管理

**ファイル：**

- `public/websocket-client.js`
- `public/index.html`（統合コード）

### 4. Cron マネージャ統合

- タスク完了時に EventBridge 通知
- タスク情報、結果、所要時間、状態を含む

**ファイル：**

- `src/tools/cron-manager.ts`

### 5. タスク実行統合

- バックグラウンドタスク完了時の EventBridge 通知
- エラー処理と失敗通知

**ファイル：**

- `src/tasks/executor.ts`

### 6. OpenClaw プラグインアダプタ

- 汎用アダプタ実装
- メッセージ送受信、設定、状態チェックをサポート
- EventBridge イベントの自動購読
- OpenClaw プラグインインタフェースとの互換

**ファイル：**

- `src/channels/openclaw-adapter/adapter.ts`

### 7. 設定とドキュメント

- Channel 設定サンプル
- EventBridge API ドキュメント
- WebUI Channel 利用ドキュメント
- OpenClaw アダプタドキュメント
- Feishu プラグインインタフェース一覧
- 統合テスト手順

**ファイル：**

- `config/channels.example.json`
- `docs/event-bridge-api.md`
- `docs/webui-channel.md`
- `docs/openclaw-adapter.md`
- `docs/feishu-interfaces.md`
- `docs/integration-testing.md`

### 8. テスト

- EventBridge の単体テスト
- WebUIChannelPlugin の単体テスト

**ファイル：**

- `src/__tests__/event-bridge.test.ts`
- `src/__tests__/webui-channel.test.ts`

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                    実行エンジン                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │ CronManager  │         │ Task Executor│             │
│  └──────┬───────┘         └──────┬───────┘             │
│         │                        │                      │
│         └────────────┬───────────┘                      │
│                      │                                  │
│                      ▼                                  │
│            ┌──────────────────┐                        │
│            │   EventBridge    │                        │
│            └────────┬─────────┘                        │
└─────────────────────┼──────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ WebUI Channel│ │  Feishu  │ │ その他チャネル │
│ (WebSocket)  │ │(OpenClaw)│ │              │
└──────┬───────┘ └────┬─────┘ └──────────────┘
       │              │
       ▼              ▼
  ┌─────────┐   ┌─────────┐
  │ Browser │   │ Feishu  │
  └─────────┘   └─────────┘
```

## 使い方

### 1. アプリの起動

```bash
npm run dev
```

WebUI Channel は自動起動し、WebSocket サーバーは `ws://localhost:8080` で待ち受けます。

### 2. タスク通知の受信

フロントは自動で WebSocket に接続し、タスク完了通知を表示します。

### 3. コマンドの送信

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

### 4. OpenClaw プラグインの統合

```typescript
import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
import feishuPlugin from '@openclaw/feishu-plugin';

const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
channelRegistry.register(adapter);
await adapter.setup.initialize();
```

## 技術選定

- **EventBridge**：Node.js EventEmitter（シンプルで軽量）
- **WebSocket**：`ws` ライブラリ（実績と安定性）
- **フロントエンド**：ネイティブ WebSocket API（追加依存なし）
- **アダプタパターン**：OpenClaw プラグインとの互換

## パフォーマンス特性

- **低遅延**：WebSocket によるリアルタイム通信
- **高同時性**：複数クライアント接続をサポート
- **耐障害性**：自動再接続とエラー分離
- **拡張性**：プラグイン指向アーキテクチャ

## 既知の制限

1. **WebSocket はローカル接続のみ** — 現行バージョンに TLS／認証は未搭載
2. **OpenClaw アダプタは最小実装** — コアインタフェースのみ
3. **メッセージの永続化なし** — オフライン時のメッセージは保存しない

## 今後の改善

- [ ] TLS/WSS のサポート
- [ ] 認証機構の追加
- [ ] メッセージの永続化
- [ ] より完全な OpenClaw インタフェース実装
- [ ] パフォーマンス監視とメトリクス

## テストカバレッジ

- EventBridge の単体テスト
- WebUIChannelPlugin の単体テスト
- 統合テスト手順（手動）

## ドキュメント

- [EventBridge API](./event-bridge-api.md)
- [WebUI Channel](./webui-channel.md)
- [OpenClaw アダプタ](./openclaw-adapter.md)
- [Feishu プラグインインタフェース一覧](./feishu-interfaces.md)
- [統合テスト手順](./integration-testing.md)

## コントリビュータ

- 実装時期：2025-04
- タスク完了：63/63（100%）
