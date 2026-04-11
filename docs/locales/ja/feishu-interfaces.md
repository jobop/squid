# OpenClaw Feishu プラグイン：コアインタフェース一覧

`openclaw-main/extensions/feishu` の分析に基づき、Feishu プラグインが主に利用するインタフェースを整理します。

## コア依存インタフェース

### 1. Plugin SDK Core

- `createChatChannelPlugin` — チャット channel プラグインの生成  
- `defineChannelPluginEntry` — プラグインエントリの定義  

### 2. Channel Config

- `createHybridChannelConfigAdapter` — ハイブリッド設定アダプタ  
- `adaptScopedAccountAccessor` — アカウントアクセスのアダプタ  

### 3. Outbound（送信）

- `createRuntimeOutboundDelegates` — ランタイム出站デリゲート  
- 実装が必要な例：  
  - `sendMessageFeishu` — テキスト送信  
  - `sendCardFeishu` — カード送信  
  - `updateCardFeishu` — カード更新  
  - `editMessageFeishu` — メッセージ編集  

### 4. Directory（連絡先）

- `createChannelDirectoryAdapter` — ディレクトリアダプタ  
- `createRuntimeDirectoryLiveAdapter` — ランタイム用ライブアダプタ  
- 実装が必要な例：  
  - `listFeishuDirectoryPeers` — 連絡先一覧  
  - `listFeishuDirectoryGroups` — グループ一覧  

### 5. Status（状態確認）

- `createComputedAccountStatusAdapter` — 計算済みアカウント状態  
- 実装が必要な例：  
  - `probeFeishu` — 接続プローブ  
  - `inspectFeishuCredentials` — 資格情報検査  

### 6. Account Management（アカウント管理）

- `resolveFeishuAccount` — アカウント解決  
- `listFeishuAccountIds` — アカウント ID 一覧  
- `resolveDefaultFeishuAccountId` — 既定アカウント ID の解決  

### 7. Session & Routing（セッションとルーティング）

- `getSessionBindingService` — セッション紐付けサービス取得  
- `resolveFeishuOutboundSessionRoute` — 出站セッションルート解決  
- `buildFeishuConversationId` — 会話 ID の構築  
- `parseFeishuConversationId` — 会話 ID の解析  

### 8. Policy & Pairing（ポリシーとペアリング）

- `createPairingPrefixStripper` — ペアリング接頭辞の除去  
- `resolveFeishuGroupToolPolicy` — グループのツールポリシー  
- `formatAllowFromLowercase` — allowFrom の小文字整形  

### 9. Setup（セットアップ）

- `feishuSetupAdapter` — セットアップアダプタ  
- `feishuSetupWizard` — セットアップウィザード  

### 10. Runtime（ランタイム）

- `setFeishuRuntime` — ランタイム設定  
- `getFeishuRuntime` — ランタイム取得  

## 最小実装方針

squid 向けには**コアの送受信**に絞ります。

### 必須（P0）

1. **メッセージ送信** — `sendMessageFeishu`  
2. **メッセージ受信** — Webhook 監視またはポーリング  
3. **アカウント設定** — appId, appSecret  
4. **状態確認** — 資格情報の有効性検証  

### 推奨（P1）

5. **セッション管理** — 会話コンテキストの記録  
6. **エラー処理** — ネットワーク／認証失敗など  

### 任意（P2）

7. カードメッセージ  
8. 連絡先同期  
9. グループポリシー  
10. 高度なルーティング  

## インタフェースの簡略マッピング

```typescript
OpenClaw インタフェース              →  squid インタフェース
─────────────────────────────────────────────────────────
sendMessageFeishu()              →  FeishuChannelPlugin.outbound.sendText() + オープンプラットフォーム im/v1/messages
Webhook 監視                      →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                  →  eventBridge.onChannelInbound（inbound.onMessage ではない）
inspectFeishuCredentials()       →  status.check()（tenant token プローブ）
resolveFeishuAccount()           →  config.getAll() のマスク済みビュー / ~/.squid/feishu-channel.json
```

## 実装状態（検証済み、P0）

- **実装ディレクトリ**：`extensions/feishu/src/`（リポジトリ同梱の拡張パッケージ）。安定した import は `src/channels/feishu` のバレル再エクスポートも利用可能。  
- **テキスト送信**：`extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`。`defaultReceiveId` / `defaultReceiveIdType` の設定が必要。  
- **既定の入站（WebSocket 長接続）**：`extensions/feishu/src/feishu-ws-inbound.ts`。`@larksuiteoapi/node-sdk` の `WSClient` + `EventDispatcher` で本機から Feishu へ能動接続。**公網 Webhook／トンネルは不要**。`connectionMode` の既定は `websocket`。  
- **任意の Webhook 入站**：`extensions/feishu/src/webhook-handler.ts`（`connectionMode: webhook` 時）。署名アルゴリズムは OpenClaw の `monitor.transport.ts` と一致。ボット自身の送信（`sender_type === app`）は再入站しない。  
- **メッセージ解析**：`extensions/feishu/src/message-inbound.ts`（`parseFeishuImReceiveForInbound`）を WS と HTTP で共有。  
- **squid との対話**：`extensions/feishu/src/squid-bridge.ts`（`registerFeishuSquidBridge`。`FeishuChannelPlugin.setup.initialize` で注入された `taskAPI` があるとき登録）がユーザメッセージを `TaskAPI.executeTaskStream` に渡し、返信を `sendFeishuTextMessageTo` で元の `chat_id` へ送る。拡張は `eventBridge.onChannelInbound` を別途購読可能。  
- **設定**：`~/.squid/feishu-channel.json`；`GET/POST /api/channels/feishu/config`（応答に完全な秘密は含めない）。**読み込み**：`config/channel-extensions.json`（または `~/.squid/channel-extensions.json`）で `feishu` 拡張を有効化する必要がある。出站設定が不完全な場合は拡張入口が失敗しつつも、チャネル一覧には合成の Feishu 行が表示され得る。  
- **互換性の結論**：[COMPATIBILITY.md](./COMPATIBILITY.md) を参照。

## 実装の優先順位

1. **フェーズ 1** — 基本送受信  
   - appId/appSecret の設定  
   - Feishu へのテキスト送信  
   - Feishu からの受信（Webhook）  
   - EventBridge 統合  

2. **フェーズ 2** — 機能強化  
   - セッション管理  
   - エラー再試行  
   - 状態監視  

3. **フェーズ 3** — 高度機能  
   - カードメッセージ  
   - グループ管理  
   - 権限制御  
