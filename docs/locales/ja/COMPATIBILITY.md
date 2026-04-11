# OpenClaw Feishu プラグインと squid の互換性に関する結論

本ドキュメントは変更 `integrate-feishu-openclaw-channel` のタスク §1 に対応し、タスク 1.1 のソースパスから追跡できます。

## 1.1 実際の `openclaw/plugin-sdk/*` 参照（extensions/feishu）

以下のパスは `openclaw-main/extensions/feishu` 配下の `.ts` ソースを静的スキャン（`from "openclaw/..."`）した結果です。

| モジュールパス |
|----------------|
| `openclaw/plugin-sdk/account-helpers` |
| `openclaw/plugin-sdk/account-id` |
| `openclaw/plugin-sdk/account-resolution` |
| `openclaw/plugin-sdk/allow-from` |
| `openclaw/plugin-sdk/channel-actions` |
| `openclaw/plugin-sdk/channel-config-helpers` |
| `openclaw/plugin-sdk/channel-contract` |
| `openclaw/plugin-sdk/channel-pairing` |
| `openclaw/plugin-sdk/channel-policy` |
| `openclaw/plugin-sdk/channel-send-result` |
| `openclaw/plugin-sdk/config-runtime` |
| `openclaw/plugin-sdk/conversation-runtime` |
| `openclaw/plugin-sdk/core` |
| `openclaw/plugin-sdk/directory-runtime` |
| `openclaw/plugin-sdk/feishu` |
| `openclaw/plugin-sdk/lazy-runtime` |
| `openclaw/plugin-sdk/media-runtime` |
| `openclaw/plugin-sdk/outbound-runtime` |
| `openclaw/plugin-sdk/reply-payload` |
| `openclaw/plugin-sdk/routing` |
| `openclaw/plugin-sdk/runtime-store` |
| `openclaw/plugin-sdk/secret-input` |
| `openclaw/plugin-sdk/setup` |
| `openclaw/plugin-sdk/status-helpers` |
| `openclaw/plugin-sdk/text-runtime` |
| `openclaw/plugin-sdk/webhook-ingress` |
| `openclaw/plugin-sdk/zod` |

ルートの `package.json` はパッケージを `@openclaw/feishu` として宣言し、**peer** 依存として `openclaw >= 2026.3.27` を要求します。ビルドと実行は完全な OpenClaw ホストを前提とします。

## 1.2 `docs/feishu-interfaces.md` の P0 との対照（squid 側）

| P0 項目 | squid の状態 |
|---------|----------------|
| メッセージ送信（`sendMessageFeishu` 相当） | **実装済み**：`FeishuChannelPlugin` + Feishu オープンプラットフォーム HTTP（`im/v1/messages`） |
| メッセージ受信（Webhook） | **実装済み**：`POST /api/feishu/webhook` → 署名検証／復号 → `submitFeishuInboundToEventBridge` |
| アカウント設定 appId / appSecret | **実装済み**：`~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config`（応答はマスク） |
| 状態確認（`probeFeishu` 相当） | **一部**：`tenant_access_token` の取得で資格情報の有効性を判断 |

## 1.3 結論

- **そのまま import して使えない**：公式プラグインは多数の `plugin-sdk` と OpenClaw ランタイムに依存し、Electrobun/Bun のデスクトッププロセスモデルと一致しないため、shim またはプロトコル層の再実装が必要です。  
- **適配層／薄いラッパーは有効**：squid は **Feishu オープンプラットフォームへの直接接続 + `ChannelPlugin` + Adapter の入站 API → `EventBridge`** を採用し、OpenClaw Feishu プラグインのランタイムを内包しません。  
- **独自実装が必要な領域**：OpenClaw 側のセッション紐付け、カード、連絡先、ペアリングウィザード等の P1/P2。将来 **互換 shim** を導入する場合は、元の入站パスを `submitFeishuInboundToEventBridge` に転送してください（`docs/openclaw-adapter.md` を参照）。

## 1.4 任意の PoC

隔離ブランチで「`@openclaw/feishu` をインスタンス化する」ランタイム PoC は未実施です。静的解析でシンボル依存面（§1.1）は示せます。PoC が必要な場合は、`openclaw` ホストとプラグイン SDK を揃えた独立 worktree でエラースタックを記録してください。

## 6. `feishu-openclaw-compatibility` spec のウォークスルー（タスク 5.3）

- **評価の文書化**：§1.3 で「適配または独立実装が必要」と結論づけ、§1.1 で OpenClaw シンボル根拠を列挙（3 件以上）。  
- **P0 のギャップ**：§1.2 で P0 は組み込みの直接接続で実装済みまたは同等カバーと明記。主な不足は OpenClaw 固有のセッション／カード等（P1/P2）。  
- **プラグインの直接再利用**：§1.3 で独立実装ルートに格下げ。公式パッケージをそのまま読み込めるとは主張していません。  
- **shim と Adapter**：現行は **薄いプロトコル層のラッパー**（shim ではない）。タスク 4.6 は **N/A**。将来 shim を入れる場合は `submitFeishuInboundToEventBridge` へ転送すること（`docs/openclaw-adapter.md` を参照）。
