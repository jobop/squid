# squid 開発者ドキュメント

デスクトップランタイムの入口は **`src/bun/index.ts`** です（Electrobun は `electrobun.config.ts` の `build.bun.entrypoint` から参照）。WebView フロントの入口は **`src/browser/`** です。既定でコピーする静的資産を変更する場合は、**`electrobun.config.ts`** の `build.copy` も必ず更新してください（CLI は **`.js` 設定ファイルを読みません**）。**リリースパッケージには `public`、`config`（`channel-extensions.json` を含む）、`extensions` が含まれる必要**があります。欠けるとチャネル拡張がスキャンできず、チャネル画面に「未登録」や「拡張用 Web 設定なし」が出ます。

## アーキテクチャ

### コアモジュール

```
src/
├── tasks/           # タスク管理
│   ├── state-machine.ts      # 状態マシン（ask/craft/plan）
│   └── context-compressor.ts # コンテキスト圧縮
├── tools/           # ツールシステム
│   ├── base.ts              # ツール型定義
│   ├── read-file.ts         # ファイル読取
│   ├── write-file.ts        # ファイル書込
│   ├── glob.ts              # ファイルマッチ
│   └── grep.ts              # 内容検索
├── models/          # AI モデル
│   ├── types.ts             # インタフェース定義
│   ├── anthropic.ts         # Anthropic アダプタ
│   ├── openai.ts            # OpenAI アダプタ
│   ├── deepseek.ts          # DeepSeek アダプタ
│   └── registry.ts          # モデルレジストリ
├── workspace/       # ワークスペース
│   ├── manager.ts           # ディレクトリ管理
│   └── sandbox.ts           # パスサンドボックス
├── permissions/     # 権限
│   ├── engine.ts            # ルールエンジン
│   └── classifier.ts        # ツール分類
├── skills/          # スキル
│   ├── loader.ts            # スキル読込
│   └── validator.ts         # 権限検証
├── experts/         # エキスパート
│   └── manager.ts           # エキスパート管理
├── channels/        # チャネル（組み込み WebUI + 拡張読込）
├── claw/            # リモート制御
│   ├── server.ts            # HTTP サーバ
│   └── task-handler.ts      # タスク処理
├── utils/           # キューと汎用
│   └── messageQueueManager.ts # 会話バケットキュー（cron 入隊を含む）
├── tools/           # ツール（スケジュールツールを含む）
│   ├── cron-manager.ts      # スケジュールと永続化
│   ├── cron-create.ts
│   ├── cron-list.ts
│   ├── cron-status.ts
│   └── cron-runs.ts
└── ui/              # UI
    ├── main-layout.tsx      # メインレイアウト
    └── task-wizard.tsx      # タスクウィザード
```

### 設計原則

1. **型安全**：TypeScript + Zod  
2. **不変性**：DeepImmutable でコンテキストを拘束  
3. **モジュール化**：単一責任と明確な境界  
4. **拡張性**：レジストリパターンで拡張  

### ツールシステム

ツールはクラス継承ではなく型定義です。

```typescript
export type Tool<Input, Output> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  maxResultSizeChars: number;
  call(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
  isConcurrencySafe(input: Input): boolean;
  isReadOnly(input: Input): boolean;
  isDestructive?(input: Input): boolean;
};
```

### モデルアダプタ

すべてのプロバイダは同一インタフェースを実装します。

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## 拡張ガイド

### 新しいツールの追加

1. `src/tools/` にファイルを追加  
2. Zod で入力スキーマを定義  
3. `Tool` 型を実装  
4. ツールレジストリへ登録  

例：

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';

const MyToolInputSchema = z.object({
  param: z.string()
});

export const MyTool: Tool<typeof MyToolInputSchema, string> = {
  name: 'my_tool',
  description: 'ツールの説明',
  inputSchema: MyToolInputSchema,
  maxResultSizeChars: 10000,
  async call(input, context) {
    return { data: 'result' };
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true
};
```

### 新しいモデルプロバイダの追加

1. `src/models/` にアダプタファイルを追加  
2. `ModelProvider` を実装  
3. `ModelRegistry` に登録  

例：

```typescript
import type { ModelProvider, ChatRequest, ChatResponse } from './types';

export class MyModelProvider implements ModelProvider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return { content: 'response' };
  }

  async *streamChat(request: ChatRequest) {
    yield { content: 'chunk' };
  }
}
```

### 新しいスキルの追加

1. `skills/` に Markdown を作成  
2. YAML frontmatter を付与  
3. システムプロンプトを記述  

例：

```markdown
---
name: my-skill
description: スキルの説明
allowed-tools:
  - read_file
  - write_file
---

あなたは専門的なアシスタントで…
```

### 新しいエキスパートの追加

`src/experts/types.ts` に定義を追加します。

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'エキスパート名',
  description: '説明',
  systemPrompt: 'あなたは…'
};
```

## テスト

```bash
npm test
npm run test:watch
```

チャネル関連の手動手順は [integration-testing.md](./integration-testing.md) を参照。`test:integration` や `test:coverage` の有無はルートの `package.json` を確認してください。

## ビルドとリリース

```bash
npm run dev
npm run build
npm run build:electron
npm run build:electron:release
```

## コントリビューション

### 言語とプロンプト（i18n 基線）

1. 新規または変更するコードコメントは英語で統一。  
2. 新規または変更する system prompt / promptTemplate は英語で統一。  
3. ユーザー向け文言は i18n キーへ。ビジネスロジックに直書きしない。  
4. ドキュメント追加は `docs/locales/<locale>/` 構造へ。未翻訳ページは英語へフォールバック。

1. リポジトリをフォーク  
2. フィーチャーブランチを作成  
3. 変更をコミット  
4. ブランチへプッシュ  
5. Pull Request を作成  

## ライセンス

MIT License
