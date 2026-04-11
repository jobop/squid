# squid v0.1.0 リリースノート

## 直近の更新（2026-04-10）

### チャネル画像認識パイプラインの補完

- Telegram / Feishu / WeChat 個人アカウントの入站画像を、「ワークスペースへダウンロード + `mentions(file)`」の共通パスに統一。  
- チャネルが混雑してキューに入る場合も同一の `mentions` を保持し、キュー経路で画像が落ちないようにした。  
- 拡張側で共有する永続化：`extensions/shared/workspace-image-store.ts` を追加。

### チャネル割り込みコマンド `/wtf`

- `TaskAPI.executeTaskStream` に `/wtf` を追加。Web の ESC と同義で、実行中のタスクのみ中断し、キューはクリアしない。  
- `/wtf` の分岐をセッション busy チェックより前に置き、「セッションが忙しい」と先に弾かれず即時に中断できるようにした。  
- Telegram / Feishu / WeChat ブリッジのテストを補完し、`/wtf` が統一コマンド分岐へ透過することを確認。

## 概要

squid の初の対外公開版：Electrobun ベースのローカル AI デスクトップワークベンチ。マルチモデル対話、タスクモード、スキルとエキスパート、スケジュールタスク、拡張可能なチャネル（Feishu / Telegram / WeChat など、必要に応じて有効化）を統合します。

## コア機能

### タスクとワークスペース

- タスクモード：Ask（読み取り寄り）、Craft（ツール自動実行）、Plan（計画と確認寄り）
- タスク状態マシンと永続化
- 作業ディレクトリの紐付けとパスサンドボックス

### モデル

- Anthropic Claude 系（設定で選択可能なモデルに準拠）
- OpenAI 互換インタフェース
- DeepSeek など互換エンドポイント（現行アダプタと設定に依存）
- ストリーミング出力とトークン集計（実装に準拠）
- API キーのローカル暗号化保存

### スキルとエキスパート

- 複数の組み込みスキルテンプレート。`~/.squid/skills` からの読み込みと SkillHub 等からのインストール
- 複数の組み込みエキスパート役割とカスタム拡張ポイント

### チャネル

- 組み込み WebUI チャネル
- 拡張チャネル：`extensions/` と `~/.squid/extensions`、宣言的設定と TaskAPI ブリッジ

### Claw と自動化

- Claw 関連 HTTP とトークン設計は `src/claw`。デスクトップ既定で Claw サービスを起動するかは `src/bun/index.ts` を参照
- node-cron ベースのスケジュールタスクと実行履歴

### デスクトップシェル

- Electrobun：Bun メインプロセス + システム WebView
- メインレイアウト、設定、タスクとセッション UI

## テスト

直近記録の自動テスト：テストファイル 9、ケース 31 が合格（[TEST_REPORT.md](./TEST_REPORT.md)）。リリース前には対象環境で `npm test` の再実行を推奨します。

## インストールとコマンド（ソース）

```bash
git clone <repository-url>
cd squid
npm install
npm test          # 任意
npm run dev       # デスクトップ開発
npm run build     # tsc
npm run build:electron:release   # 安定チャネルのデスクトップ成果物（artifacts/ へ出力）
```

## 設定

初回：アプリ **設定** でモデルキーを入力して保存。チャネルと Feishu は [QUICK_START.md](./QUICK_START.md)、[channel-extensions.md](./channel-extensions.md) を参照。

**ビルド注意**：Electrobun は **`electrobun.config.ts` のみ**を読みます。このファイルがない、または誤って `.js` にすると stable パッケージに `public` がコピーされず、画面が真っ白になることがあります。

## ドキュメント索引

- [user-guide.md](./user-guide.md)
- [developer-guide.md](./developer-guide.md)
- [TEST_REPORT.md](./TEST_REPORT.md)
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

## セキュリティ

- ワークスペースのパス検証とツール権限の分類
- キーのローカル暗号化保存
- ローカル HTTP サービスは既定で公網に晒さない設計

## 既知の制限

- 一部 UI とセレクタは継続改善中（Issue とマイルストーンを参照）
- macOS で未署名・未公証の配布物は Gatekeeper が反応する場合がある。配布には Developer ID 署名と公証を推奨

## 今後の方向性（計画）

- スキルとチャネルエコシステム、設定、可観測性の強化
- パフォーマンスと体験の最適化

## ライセンス

MIT License

---

**リリース日**：2026-04-04（リポジトリ保守に伴い更新）  
**バージョン**：v0.1.0  
**状態**：保守中
