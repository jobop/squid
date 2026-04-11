# squid プロジェクト概要

本稿はリポジトリの能力範囲とモジュール分割を要約し、プロダクトおよび技術レビュー向けです。実装と齟齬がある場合はソースを正とします。

## ポジショニング

squid：ローカル優先の AI デスクトップワークベンチ（Electrobun + Bun + システム WebView）。データの既定保存先はユーザーディレクトリの `~/.squid` です。

## 実装済み能力（要約）

### タスクとコンテキスト

- タスクデータモデルと Ask / Craft / Plan の状態マシン  
- コンテキスト圧縮とタスクの永続化  
- 権限とツールのリスク分類  

### モデル

- Anthropic、OpenAI、DeepSeek などのアダプタとレジストリ（`src/models` を参照）  
- ストリーミング、トークン集計、キーの暗号化保存  

### ワークスペースとツール

- 作業ディレクトリの紐付けとパスサンドボックス  
- ReadFile、WriteFile、Glob、Grep と、統一されたツール結果マッピングとサイズ上限  

### スキルとエキスパート

- スキル YAML、ローダー、ホワイトリスト、Hooks  
- 組み込みスキルとエキスパートのテンプレート。UI 側は一部継続開発中  

### Claw とスケジューリング

- Claw HTTP サービスとタスク処理（`src/claw`）。デスクトップ既定で有効かは `src/bun/index.ts` を参照  
- node-cron によるスケジュールタスク、実行履歴、メール系通知（設定時）  

### チャネル

- Channel レジストリ、組み込み WebUI  
- 拡張チャネル：`extensions/` とユーザーディレクトリ、宣言的 manifest と TaskAPI ブリッジ  
- EventBridge、WebSocket など UI との統合（[webui-channel.md](./webui-channel.md) など）  

### デスクトップとフロントエンド

- React メイン UI、設定、タスクとセッション関連ページ  
- ローカル HTTP API（メインプロセス `Bun.serve`、UI から呼び出し）  

### 品質

- Vitest による単体および統合寄りのテスト（[TEST_REPORT.md](./TEST_REPORT.md)）  
- 利用者向け・開発者向けドキュメントは `docs/`  

## テストと品質ゲート

直近のアーカイブ：テストファイル 9、ケース 31 が合格（TEST_REPORT 参照）。マージ前にローカルで `npm test` 実行を推奨します。

## セキュリティ（要約）

- パスサンドボックスとツールの読み取り専用／破壊的フラグ  
- キーの AES-256-GCM などローカル保護（`secure-storage` 実装に準拠）  
- Claw トークンと権限エンジン（該当パスを有効化した場合）  

## パフォーマンス（要約）

- LRU、仮想スクロール、遅延読み込み、ストリーム応答、コンテキスト圧縮など（各モジュールの実装に準拠）  

## ドキュメント

| ドキュメント | 用途 |
|--------------|------|
| [QUICK_START.md](./QUICK_START.md) | 利用者向けクイックスタート |
| [user-guide.md](./user-guide.md) | 機能説明 |
| [developer-guide.md](./developer-guide.md) | アーキテクチャと拡張 |
| [tool-development-guide.md](./tool-development-guide.md) | ツール開発規約 |
| [TEST_REPORT.md](./TEST_REPORT.md) | テストレポート |

## バージョン状態

リポジトリのバージョン番号は `package.json` を参照。リリースノートは [RELEASE_NOTES.md](./RELEASE_NOTES.md) です。
