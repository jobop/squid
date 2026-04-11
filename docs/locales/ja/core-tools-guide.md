# コアツール利用ガイド

本稿では squid に追加された 10 個のコアツールの使い方と制限を説明します。

## 1. FileEditTool (file_edit)

**機能**：文字列一致で検索し、ファイル内容を正確に置換します。

**入力パラメータ**：

- `file_path` (string)：編集するファイルパス  
- `old_string` (string)：置換前の文字列  
- `new_string` (string)：置換後の文字列  
- `replace_all` (boolean, 任意)：すべての一致を置換するか（既定 false）

**使用例**：

```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**制限**：

- 複数一致があり `replace_all=true` でない場合はエラーを返す  
- 正規表現ではなく、厳密な文字列一致のみ

---

## 2. BashTool (bash)

**機能**：Bash コマンドを実行。タイムアウトとバックグラウンド実行をサポート。

**入力パラメータ**：

- `command` (string)：実行する Bash コマンド  
- `working_directory` (string, 任意)：作業ディレクトリ  
- `timeout` (number, 任意)：タイムアウト（ミリ秒）。既定 30000  
- `run_in_background` (boolean, 任意)：バックグラウンド実行するか

**使用例**：

```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**制限**：

- 対話型コマンドは非対応  
- バックグラウンドタスクは永続化されず、再起動で失われる  
- 破壊的操作としてマークされ、ユーザーの信頼が前提

---

## 3. PowerShellTool (powershell)

**機能**：PowerShell コマンドを実行（Windows のみ）。

**入力パラメータ**：

- `command` (string)：実行する PowerShell コマンド  
- `working_directory` (string, 任意)：作業ディレクトリ  
- `timeout` (number, 任意)：タイムアウト（ミリ秒）。既定 30000  
- `run_in_background` (boolean, 任意)：バックグラウンド実行するか

**使用例**：

```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**制限**：

- Windows プラットフォームのみ利用可能  
- Windows 以外ではエラーを返す

---

## 4. WebSearchTool (web_search)

**機能**：DuckDuckGo でウェブ検索し、結果リストを返します。

**入力パラメータ**：

- `query` (string)：検索クエリ  
- `max_results` (number, 任意)：最大件数（既定 10、最大 10）

**使用例**：

```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**制限**：

- DuckDuckGo の HTML 構造に依存し、サイト改修で壊れる可能性  
- API キー不要だが、有料 API より品質が劣る場合がある  
- 最大 10 件まで

---

## 5. Cron ツール群

### 5.1 CronCreateTool (cron_create)

**機能**：スケジュールタスクを作成。

**入力パラメータ**：

- `cron_expression` (string)：Cron 式（例：`"0 * * * *"` は毎時）  
- `task_content` (string)：タスク内容の説明

**使用例**：

```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "毎朝 9 時にバックアップを実行"
}
```

### 5.2 CronDeleteTool (cron_delete)

**機能**：指定したスケジュールタスクを削除。

**入力パラメータ**：

- `task_id` (string)：削除するタスク ID

### 5.3 CronListTool (cron_list)

**機能**：すべてのスケジュールタスクを一覧。

**入力パラメータ**：なし

**制限**：

- タスクはメモリ保持で、再起動で失われる  
- 永続化は未サポート（将来バージョンで追加の可能性）

---

## 6. SkillTool (skill)

**機能**：登録済みスキル（事前定義タスクテンプレート）を呼び出す。

**入力パラメータ**：

- `skill_name` (string)：スキル名  
- `args` (string, 任意)：スキルへ渡す引数

**使用例**：

```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**制限**：

- `user-invocable: true` のスキルのみ呼び出し可能  
- スキルファイルは `~/.squid/skills/` に配置  
- スキル実行はモデル設定（`~/.squid/config.json`）に依存  
- 統一実行パスを通り、ツール呼び出しを伴うことがある

---

## 7. BriefTool (brief)

**機能**：要約を生成。複数の要約タイプをサポート。

**入力パラメータ**：

- `content` (string)：要約対象の本文  
- `prompt` (string, 任意)：カスタムプロンプト  
- `type` (enum, 任意)：要約タイプ — `brief`（短い）、`detailed`（詳細）、`bullet_points`（箇条書き）

**使用例**：

```typescript
{
  content: "長文の本文…",
  type: "bullet_points"
}
```

**制限**：

- 環境変数 `ANTHROPIC_API_KEY` が必要  
- 50000 文字を超える内容は切り詰め  
- 外部 API に依存し、課金が発生し得る

---

## 8. AgentTool (agent)

**機能**：子エージェントを起動して複雑なタスクを実行。独立したコンテキストを持つ。

**入力パラメータ**：

- `instruction` (string)：実行するタスク指示  
- `timeout` (number, 任意)：タイムアウト（ミリ秒）。既定 300000（5 分）

**使用例**：

```typescript
{
  instruction: "プロジェクト内の TypeScript ファイルを分析し、潜在的な性能問題を列挙する",
  timeout: 600000
}
```

**制限**：

- モデル設定（`~/.squid/config.json`）に依存  
- 既定タイムアウト 5 分。`timeout` で上書き可能  
- 統一実行パスで動作し、構造化メタ情報（実行器、モード、作業ディレクトリ、所要時間）を返す

---

## ツール属性の説明

各ツールは次の属性を持ちます。

- **isConcurrencySafe**：並列実行してよいか  
- **isReadOnly**：読み取り専用か  
- **isDestructive**：破壊的操作（システム状態を変え得る）か

## 結果の永続化

すべてのツールは `mapToolResultToToolResultBlockParam` を実装し、結果の永続化をサポートします。

- 結果が `maxResultSizeChars` を超えると自動的にディスクへ保存  
- プレビューを返し、コンテキスト消費を抑制

## セキュリティ上の注意

1. **BashTool と PowerShellTool**：任意のシステムコマンドを実行できるため慎重に使用  
2. **FileEditTool**：ファイルを直接変更する。バージョン管理下での利用を推奨  
3. **BriefTool と AgentTool**：外部 API を呼ぶため API キーを保護すること  
4. **WebSearchTool**：取得内容に悪意あるコードが含まれる可能性があるため検証すること

## テストカバレッジ

すべてのツールに単体テストがあります。

- 正常系  
- 境界条件  
- エラー処理  
- インタフェース適合性  

テスト実行：

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
