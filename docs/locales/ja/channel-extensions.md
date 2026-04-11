# Channel 拡張プラグイン（動的読み込み）

## P0 信頼モデル（必読）

拡張は Bun の **動的 `import()`** でメインプロセスと**同一プロセス**で動作し、**メモリ上のサンドボックス分離ではありません**。**信頼できる拡張のみ**をインストール・設定してください（出所が明確で監査可能）。`roots` が未設定のときは拡張を一切読み込みません。**Feishu** はリポジトリの `extensions/feishu/` に同梱され、既定では `config/channel-extensions.json` の `enabled: ["feishu"]` で読み込まれます（チャネル画面のソースは「拡張」表示）。

優先度と衝突：

- **組み込み**は WebUI のみ。Feishu とその他の拡張はローダーで登録。拡張は既登録と同じ `id` を**上書きしてはならない**（組み込み `webui` が拡張より先）。衝突時はスキップし、`GET /api/channels` の `errors` に記録。  
- 二つの拡張パッケージが同一 `id` を宣言した場合、**先に登録に成功した方が有効**で、後からはスキップ。

## パッケージ構造

各プラグインは 1 サブディレクトリ。親ディレクトリは設定の `roots` が指します。

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # または .js。main で指定
```

### channel-plugin.json

| フィールド | 説明 |
|------------|------|
| `id` | 一意の id。入口ファクトリが返す `ChannelPlugin.id` と一致させる |
| `name` | 表示名 |
| `version` | バージョン文字列 |
| `main` | プラグインディレクトリからの相対 ESM 入口。絶対パスや `..` を含めない |
| `capabilities` / `permissions` | 任意。将来用 |

### 入口モジュール

**既定エクスポート**または名前付き **`createChannelPlugin`** を用意し、`ChannelPlugin` または `Promise<ChannelPlugin>` を返すファクトリにします。

インタフェースは `src/channels/types.ts` を参照（`config`、`outbound`、`status` は必須。長接続などは `setup` を推奨）。

## 設定

次の 2 か所をマージ（両方ある場合は `roots` をマージ。`enabled` は **`~/.squid/channel-extensions.json` を優先**）：

1. `squid/config/channel-extensions.json`（自前作成可。`config/channel-extensions.example.json` を参照）  
2. `~/.squid/channel-extensions.json`

フィールド：

- **`roots`**：`string[]`。各要素は**複数プラグイン子ディレクトリを含む親パス**。絶対パス、または **squid リポジトリルート**からの相対パス。  
- **`enabled`**（任意）：省略または `null` なら検証を通過した候補をすべて試行読み込み。`[]` なら拡張を読み込まない。非空配列なら**列挙した `id` のみ**読み込む。

### ユーザーディレクトリ `~/.squid/extensions`（roots に書かなくてよい）

本機に **`~/.squid/extensions`** が存在すると、上記 `roots` に**自動で**追加のスキャンルートとしてマージされます（存在しなければ無視。エラーにしない）。例：`~/.squid/extensions/my-plugin/channel-plugin.json`。読み込み可否は引き続き **`enabled`** のホワイトリストに従います（既定が `feishu` のみの場合、カスタムプラグインの `id` を `~/.squid/channel-extensions.json` またはプロジェクト設定の `enabled` に追加する必要があります）。

設定変更後は**ホストプロセスを再起動**してください。

## 例

リポジトリ同梱の `extensions/example-echo-channel/` を使う場合、`config/channel-extensions.json` に次を書きます。

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

再起動後、サイドバー「チャネル」にソース「拡張」の `echo-demo` が現れるはずです。

## API

- `GET /api/channels` は `{ "channels": [...], "errors": [...] }` を返します。各 channel に `source`: `"builtin"` | `"extension"`。`errors` は拡張のスキャン／読み込み段階の非致命エラー（秘密情報は含みません）。

## ローカルデバッグ

1. `roots` 下に子ディレクトリと `channel-plugin.json` を作成。  
2. 入口が TypeScript の場合、**Bun** で読み込まれることを確認（現行デスクトップバックエンドは Bun）。  
3. コンソールの `[ChannelExtensions]` ログと UI 上部のオレンジ色バナーを確認。

## 会話ビジー時のキューと返信（`QueuedCommand` を増やさない）

Feishu / Telegram と同様、新しいチャネルで**キュー完了後にアシスタント本文を同一会話へ返す**には：

1. 拡張の **`setup.initialize`** で、ファクトリコンテキストに **`ctx.taskAPI`** がある場合（宿主が `initializeBuiltinChannels(taskAPI)` で注入）、**`registerXxxSquidBridge(ctx.taskAPI)`**（または同等）を呼び、ブリッジ内で **`taskAPI.addChannelQueuedCompleteHandler(...)`** を登録。`cmd.channelReply?.channelId === '<あなたの channel id>'` のときだけメッセージ送信。**`setup.cleanup`** でブリッジの登録解除関数を呼ぶ。**宿主側で**チャネルごとに `import registerXxxSquidBridge` する必要はない。  
2. 会話がビジーなとき **`enqueueFromRequest(..., { channelReply: { channelId: '<同上>', chatId: '<ルーティングキー>' } })`**。`chatId` はチャネルが解釈するコア文字列。

型は `src/utils/messageQueueManager.ts` の **`ChannelQueueReply`**。コアに `xxxChatId` フィールドを増やさないでください。

## 組み込みコントリビューションとの関係

- **組み込み**：引き続き PR で `src/channels` に実装を追加し `initializeBuiltinChannels` で登録可能。  
- **拡張**：プライベートプラグインや実験的チャネル向け。コアの登録表を変えずに済む。セキュリティ責任はデプロイ側の設定と拡張の出所に依存。
