# Tencent SkillHub 連携メモ

## 機能概要

現行バージョンでは Tencent SkillHub の基礎連携を追加しています。

- スキルカタログの表示（キーワード検索対応）  
- インストール状態の表示（未インストール／インストール済み／更新あり）  
- ワンクリックでローカルスキルディレクトリへインストール  

## バックエンド API

### 1) Tencent SkillHub 一覧の取得

- `GET /api/skillhub/tencent/skills`  
- クエリ：  
  - `query`（任意）：検索キーワード  
  - `limit`（任意）：件数。既定 `20`  

レスポンス例：

```json
{
  "success": true,
  "skills": [
    {
      "slug": "demo-skill",
      "name": "Demo Skill",
      "description": "Demo",
      "latestVersion": "1.0.0",
      "installStatus": "not_installed",
      "installedVersion": null
    }
  ],
  "total": 1
}
```

### 2) Tencent SkillHub スキルのインストール

- `POST /api/skillhub/tencent/install`  
- ボディ：  
  - `slug`（必須）：スキル識別子  
  - `version`（任意）：指定バージョン。省略時は最新  
  - `force`（任意）：上書きインストールするか  

レスポンス例：

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## 設定

次のソースを優先順に参照します（高い順）。

1. 環境変数：  
   - `TENCENT_SKILLHUB_BASE_URL`  
   - `TENCENT_SKILLHUB_TOKEN`  
2. `~/.squid/config.json`：  
   - `model.skillhub.tencent.baseUrl`  
   - `model.skillhub.tencent.token`  
   - または `model.tencentSkillHub.baseUrl` / `token`  
3. 既定 URL：`https://skillhub.tencent.com/api/v1`  

## ローカルメタデータ

インストール元とロックファイルは次に書き込まれます。

- `~/.squid/skillhub/tencent/lock.json`  
- `~/.squid/skillhub/tencent/origins/<slug>.json`  

## トラブルシューティング

- **一覧が空**：`baseUrl` に到達できるか、検索キーワードが狭すぎないかを確認。  
- **インストール失敗（パッケージ構造が無効）**：返却パッケージに `SKILL.md` が含まれるか確認。  
- **重複インストールで失敗**：`force: true` で再インストールするか、ローカルの同名スキルディレクトリを削除。  
