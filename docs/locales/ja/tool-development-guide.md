# ツール開発ガイド

squid におけるツール実装の規約です。すべてのツールが同一パターンに従い、コンテキスト利用とユーザー体験を最適化します。

## コア原則

1. **コンテキスト効率** — 大きな結果は自動永続化し、コンテキスト消費を抑える  
2. **統一された出力形式** — マッピングメソッドで標準形式へ変換  
3. **後方互換** — 既存ツールを壊さない  
4. **テスト容易性** — 挙動を検証可能にする  

## ツールインタフェース

各ツールは次を実装する必要があります。

```typescript
interface Tool<Input extends z.ZodType = z.ZodType, Output = unknown, P = any> {
  name: string;
  description: string;
  inputSchema: Input;
  maxResultSizeChars: number;
  call(
    input: z.infer<Input>,
    context: ToolContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string
  ): ToolResultBlockParam;
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
}
```

## 主要プロパティ

### maxResultSizeChars

結果がこのサイズを超えるとディスクへ自動保存し、プレビューを返します。

**推奨値：**

- 既定のツール：`50000`（約 50KB）  
- 大出力ツール（ファイル読取など）：`50000`  
- 自前でサイズを抑えるツール：`Infinity`（永続化を無効化）  

**例：**

```typescript
export const ReadFileTool: Tool = {
  name: 'read_file',
  maxResultSizeChars: Infinity,
};

export const GrepTool: Tool = {
  name: 'grep',
  maxResultSizeChars: 50000,
};
```

### isConcurrencySafe と同一ラウンドのオーケストレーション

TaskExecutor は、同一アシスタントメッセージ内の複数 `tool_call` を **パーティション** します：隣接し、かつ **現在の引数** で `isConcurrencySafe` がともに真なら一段にまとめ `Promise.all`、そうでなければ順次実行します。`write_file` / `file_edit` 等の書き込み系を並列可能と宣言する場合でも **バッチ内の副作用**（衝突するパスなど）に注意してください。ホストは書き込みパスについてバッチ内検証を行うため、`isConcurrencySafe` は「この入力では他呼び出しと並列でも安全か」を正直に反映してください。

## mapToolResultToToolResultBlockParam の実装

API 標準形式へ変換する最重要メソッドです。

### 基本パターン

```typescript
mapToolResultToToolResultBlockParam(
  content: Output,
  toolUseID: string
): ToolResultBlockParam {
  if (!content) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `(${this.name} completed with no output)`,
    };
  }
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: this.formatOutput(content),
  };
}
```

### テキスト結果

```typescript
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### 構造化結果

```typescript
mapToolResultToToolResultBlockParam(
  content: { matches: string[]; count: number },
  toolUseID: string
) {
  const formatted = `一致 ${content.count} 件:\n${content.matches.join('\n')}`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: formatted,
  };
}
```

### エラー結果

```typescript
mapToolResultToToolResultBlockParam(
  content: { error: string } | string,
  toolUseID: string
) {
  const isError = typeof content === 'object' && 'error' in content;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: isError ? content.error : content,
    is_error: isError,
  };
}
```

### 複雑な整形（ReadFile の例）

```typescript
mapToolResultToToolResultBlockParam(
  content: { path: string; content: string; lines: number },
  toolUseID: string
) {
  const header = `File: ${content.path} (${content.lines} lines)\n\n`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: header + content.content,
  };
}
```

## 永続化システムとの連携

ツール作者が手動で永続化を扱う必要はありません。システムは自動で：

1. `mapToolResultToToolResultBlockParam` を呼び整形結果を取得  
2. `maxResultSizeChars` を超えないか判定  
3. 超過時は `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt` へ保存  
4. 本文をプレビューメッセージに置換  

**プレビュー形式：**

```
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[先頭 2000 バイト]
...
</persisted-output>
```

## 完全なツール例

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';

const GrepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

type GrepInput = z.infer<typeof GrepInputSchema>;
type GrepOutput = {
  matches: Array<{ file: string; line: number; content: string }>;
  count: number;
};

export const GrepTool: Tool<typeof GrepInputSchema, GrepOutput> = {
  name: 'grep',
  description: 'Search for patterns in files',
  inputSchema: GrepInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: GrepInput,
    context: ToolContext
  ): Promise<ToolResult<GrepOutput>> {
    const matches = await searchFiles(input.pattern, input.path);
    return {
      data: {
        matches,
        count: matches.length,
      },
    };
  },

  mapToolResultToToolResultBlockParam(
    content: GrepOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || content.count === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: 'No matches found',
      };
    }

    const formatted = [
      `Found ${content.count} matches:`,
      '',
      ...content.matches.map(m => 
        `${m.file}:${m.line}: ${m.content}`
      ),
    ].join('\n');

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: formatted,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false,
};
```

## テストガイド

### 単体テスト

マッピングの各シナリオをテストします。

```typescript
describe('GrepTool.mapToolResultToToolResultBlockParam', () => {
  it('should format matches correctly', () => {
    const output: GrepOutput = {
      matches: [
        { file: 'test.ts', line: 10, content: 'const foo = "bar"' },
      ],
      count: 1,
    };
    const result = GrepTool.mapToolResultToToolResultBlockParam(
      output,
      'test-id'
    );
    expect(result.content).toContain('Found 1 matches');
    expect(result.content).toContain('test.ts:10');
  });

  it('should handle empty results', () => {
    const output: GrepOutput = { matches: [], count: 0 };
    const result = GrepTool.mapToolResultToToolResultBlockParam(
      output,
      'test-id'
    );
    expect(result.content).toBe('No matches found');
  });
});
```

### 統合テスト

永続化の挙動をテストします。

```typescript
describe('Tool result persistence', () => {
  it('should persist large results', async () => {
    const largeContent = 'x'.repeat(60000);
    const result = await GrepTool.call(
      { pattern: 'test', path: '.' },
      context
    );
    const mapped = GrepTool.mapToolResultToToolResultBlockParam(
      result.data,
      'test-id'
    );
    const processed = await processToolResultBlock(
      GrepTool,
      result.data,
      'test-id'
    );
    expect(processed.content).toContain('<persisted-output>');
    expect(processed.content).toContain('Full output saved to:');
  });
});
```

## 既存ツールの移行

### ステップ 1：`maxResultSizeChars` を追加

```typescript
export const MyTool: Tool = {
  maxResultSizeChars: 50000,
};
```

### ステップ 2：マッピングメソッドを実装

```typescript
mapToolResultToToolResultBlockParam(content, toolUseID) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  };
},
```

### ステップ 3：テスト

- 小さい結果はそのまま返る  
- 大きい結果は永続化されプレビューになる  
- 整形が期待どおりか  

## FAQ

### Q: `maxResultSizeChars` を Infinity にすべきときは？

A: ツール自身が出力サイズを抑えている場合。ReadFile は `limit` で行数を制御できるため追加の永続化が不要、など。

### Q: マッピングでエラーを扱うべき？

A: はい。`call` がエラー情報を返す場合は `is_error: true` を付与します。

### Q: マッピングで重い整形はよいか？

A: 可能ですが毎回呼ばれるため高速に保ってください。

### Q: バイナリや画像は？

A: 永続化はテキストのみ。画像はマッピングで image ブロックの配列を返すなどし、システムが永続化をスキップします。

### Q: 永続化ファイルは自動削除される？

A: `~/.squid/sessions/<sessionId>/tool-results/` に保存されます。定期的なクリーンアップを推奨します。

- **手動**：古いセッションディレクトリを削除  
- **自動**：7 日超などのポリシーでスクリプト削除  
- **ディスク**：`~/.squid/sessions/` のサイズを監視し閾値で古いものから削除  

**例：**

```bash
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## 永続化ファイルの管理

### 保存場所

- **パス**：`~/.squid/sessions/<sessionId>/tool-results/`  
- **ファイル名**：`<toolUseId>.txt` または `<toolUseId>.json`  
- **セッション分離**：セッションごとに独立ディレクトリ  

### クリーンアップ方針

1. **時間ベース** — N 日より古いセッションを削除  
2. **サイズベース** — 合計が閾値を超えたら古い順に削除  
3. **セッション終了時** — 終了直後に削除するポリシーも可  

### 監視

- `~/.squid/sessions/` のサイズを定期チェック  
- ディスク不足時の警告  
- 永続化失敗回数の記録  

## 参考

- **claude-code-main 実装**：参照リポジトリの `src/utils/toolResultStorage.ts`  
- **Tool 型定義**：`src/tools/base.ts`  
- **サンプル実装**：`src/tools/read-file.ts`, `src/tools/grep.ts`  

## 更新履歴

- **2026-04-04**：初版。ツール実装規約を定義  
