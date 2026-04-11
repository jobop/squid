# OpenClaw プラグイン適配ドキュメント

## 概要

OpenClaw の channel プラグインを squid 上で動かすための手順と方針を説明します。

## 背景

OpenClaw は成熟したマルチチャネル AI アシスタント基盤で、Feishu、DingTalk、Telegram、Discord など豊富な channel プラグインがあります。squid は最小限の適配層により、これらのプラグインを squid 上で動かせるようにします。

## 互換性方針

**原則：必要なところだけ実装し、完全互換を目指さない**

- プラグインが実際に呼ぶインタフェースだけを実装する  
- 妥当な既定値や縮退動作を提供する  
- OpenClaw の全 API を一度に実装しない（必要に応じて拡張）  

## アーキテクチャ

```
┌──────────────────┐
│ OpenClaw Plugin  │
│  (Feishu 等)     │
└────────┬─────────┘
         │
         │ OpenClaw インタフェース呼び出し
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── 適配層
└────────┬─────────┘
         │
         │ squid インタフェースへ変換
         ▼
┌──────────────────┐
│  EventBridge     │
└──────────────────┘
```

## Feishu：Adapter 入站 API と EventBridge（組み込み実装）

squid は **Feishu オープンプラットフォームへの直接接続**（`FeishuChannelPlugin`）を組み込み、OpenClaw の `@openclaw/feishu` ランタイムには依存しません。入站メッセージの**唯一の**投入先は次のとおりです。

| 項目 | 説明 |
|------|------|
| モジュール | `extensions/feishu/src/inbound-adapter.ts` |
| 関数 | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| ペイロード | `text`（必須）、`chatId`、`messageId`、`senderOpenId`、`accountId`、`raw`（任意の生 JSON） |
| イベント名 | `channel:inbound`（定数 `CHANNEL_INBOUND_EVENT`） |
| Payload 形状 | `ChannelInboundEvent`（`src/channels/bridge/event-bridge.ts` 参照）。`channelId: 'feishu'`、`timestamp` を含む |

**既定**では `FeishuChannelPlugin` が **WebSocket 長接続**（`feishu-ws-inbound.ts`）を起動し、イベントを受け取って同じ Adapter へ渡します。`connectionMode: webhook` のときのみ HTTP ルート `POST /api/feishu/webhook` を使い、署名検証（および任意の復号）のあと**上記関数のみ**を呼びます。

**squid Feishu ブリッジ**：`registerFeishuSquidBridge(taskAPI)` は Feishu 拡張が `setup.initialize` 内で呼び出します（`TaskAPI` は `initializeBuiltinChannels(taskAPI)` から拡張ファクトリへ注入）。`channel:inbound` を購読し、ユーザテキストを `TaskAPI.executeTaskStream`（`conversationId` は `feishubot_<chatId>`）に渡し、モデル応答を `sendFeishuTextMessageTo` で**同一チャット／グループ**へ返します。拡張は `eventBridge.onChannelInbound` を別途購読できます。

将来 **OpenClaw 互換 shim** を採用する場合、shim はプラグイン側の入站を `submitFeishuInboundToEventBridge`（または同等の薄いラッパー）へ**必ず**転送し、`feishu-openclaw-compatibility` spec を満たす必要があります。

## 実装手順

### 手順 1: プラグインコードの調査

対象プラグインが実際に利用している OpenClaw インタフェースを洗い出します。

**例：Feishu プラグインの分析**

```bash
cd openclaw-main/extensions/feishu
grep -r "runtime\." src/
```

よくあるインタフェースの例：

- `runtime.text.chunkText` — テキスト分割  
- `runtime.reply.dispatchReply` — 返信の送出  
- `runtime.routing.resolveAgentRoute` — ルート解決  
- `runtime.pairing.*` — ペアリング管理  

### 手順 2: アダプタの作成

`src/channels/openclaw-adapter/adapter.ts` を参照・拡張します。

```typescript
import { ChannelPlugin } from '../types';
import { eventBridge } from '../bridge/event-bridge';

export class OpenClawChannelAdapter implements ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  constructor(private openclawPlugin: any) {
    this.id = openclawPlugin.id || 'openclaw-plugin';
    this.meta = {
      name: openclawPlugin.name || 'OpenClaw Plugin',
      description: 'OpenClaw プラグイン適配',
      category: 'third-party',
    };
    
    this.capabilities = {
      outbound: { text: true, media: false, rich: true, streaming: false },
      inbound: { text: true, commands: true, interactive: true },
    };
  }

  config = {
    get: (key: string) => this.openclawPlugin.config?.[key],
    set: (key: string, value: any) => {
      if (this.openclawPlugin.config) {
        this.openclawPlugin.config[key] = value;
      }
    },
    getAll: () => this.openclawPlugin.config || {},
    validate: () => true,
  };

  outbound = {
    sendText: async (params) => {
      try {
        await this.openclawPlugin.send({
          content: params.content,
          title: params.title,
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    sendNotification: async (message) => {
      return this.outbound.sendText({
        content: message.content,
        title: message.title,
      });
    },
  };

  inbound = {
    onMessage: (callback) => {
      if (this.openclawPlugin.on) {
        this.openclawPlugin.on('message', (msg: any) => {
          callback(msg);
          if (msg.type === 'command') {
            eventBridge.sendCommand(msg.command, msg.args, this.id);
          }
        });
      }
    },
  };

  status = {
    check: async () => {
      if (this.openclawPlugin.isConnected) {
        const connected = await this.openclawPlugin.isConnected();
        return {
          healthy: connected,
          message: connected ? '接続済み' : '未接続',
        };
      }
      return { healthy: true, message: '状態不明' };
    },
  };

  setup = {
    initialize: async () => {
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      }
      eventBridge.onTaskComplete((event) => {
        this.outbound.sendText({
          content: `タスク ${event.taskId} が完了`,
        });
      });
    },
    cleanup: async () => {
      if (this.openclawPlugin.cleanup) {
        await this.openclawPlugin.cleanup();
      }
    },
  };
}
```

### 手順 3: ランタイムインタフェースの提供

OpenClaw プラグインがランタイム API を必要とする場合の最小実装例：

```typescript
// src/channels/openclaw-adapter/runtime.ts

export const createMinimalRuntime = () => {
  return {
    text: {
      chunkText: (text: string, limit: number) => {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += limit) {
          chunks.push(text.slice(i, i + limit));
        }
        return chunks;
      },
      chunkMarkdownText: (text: string, limit: number) => {
        return createMinimalRuntime().text.chunkText(text, limit);
      },
    },
    reply: {
      dispatchReply: async (params: any) => {
        console.log('Dispatch reply:', params);
      },
    },
    routing: {
      resolveAgentRoute: (params: any) => {
        return { sessionKey: 'default', agentId: 'default' };
      },
    },
  };
};
```

### 手順 4: プラグインの読み込み

```typescript
import { OpenClawChannelAdapter } from './openclaw-adapter/adapter';
import { createMinimalRuntime } from './openclaw-adapter/runtime';

async function loadOpenClawPlugin(pluginPath: string) {
  const pluginModule = await import(pluginPath);
  const PluginClass = pluginModule.default || pluginModule.Plugin;
  const runtime = createMinimalRuntime();
  const plugin = new PluginClass({ runtime });
  const adapter = new OpenClawChannelAdapter(plugin);
  channelRegistry.register(adapter);
  if (adapter.setup) {
    await adapter.setup.initialize();
  }
  return adapter;
}
```

## 既知の制限

### 現行バージョンで未サポートの例

1. **ランタイム API の完全実装** — コアのみ  
2. **ペアリング管理** — pairing 系は未実装  
3. **メディア処理** — アップロード／ダウンロードは未実装  
4. **セッション管理** — 複雑なセッション紐付けは未実装  
5. **権限制御** — allowlist 等は未実装  

### 対処の方向

- **案 1：** 必要に応じて実装 — エラーメッセージから不足 API を追加  
- **案 2：** モック — 重要でない API は空実装  
- **案 3：** プラグイン改修 — コードが編集可能なら不要依存を削る  

## テストチェックリスト

適配後に確認すべき項目：

- [ ] プラグインが正常に読み込み・初期化できる  
- [ ] squid からのタスク通知を受け取れる  
- [ ] 対象プラットフォーム（Feishu 等）へメッセージを送れる  
- [ ] 対象プラットフォームからメッセージを受信できる  
- [ ] ユーザコマンドを squid に転送できる  
- [ ] エラー処理が期待どおり動く  
- [ ] 切断後に自動再接続できる  

## 例：Feishu プラグインの適配

```typescript
npm install @openclaw/feishu-plugin

import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');

feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');

await feishuPlugin.outbound.sendText({
  content: 'テストメッセージ',
});
```

## トラブルシューティング

### プラグイン読み込み失敗

1. プラグインパスが正しいか  
2. 依存パッケージが揃っているか  
3. スタックトレースから不足インタフェースを特定  

### メッセージ送信失敗

1. 設定（appId、appSecret 等）  
2. ネットワーク接続  
3. 対象プラットフォームの API ドキュメント  

### インタフェース非互換

1. エラーから呼ばれている API を特定  
2. アダプタに該当メソッドを追加  
3. 複雑な場合は簡略版を提供  

## コントリビューション

適配に成功したら次を共有してください。

1. 実装が必要だったインタフェース一覧  
2. アダプタコード  
3. テストケース  
4. 本ドキュメントの更新  

## 参考リンク

- [OpenClaw 公式リポジトリ](https://github.com/openclaw/openclaw)  
- [OpenClaw Channel 型定義](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)  
- [Feishu オープンプラットフォーム ドキュメント](https://open.feishu.cn/document/)  
