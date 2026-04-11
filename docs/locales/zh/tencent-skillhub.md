# 腾讯 SkillHub 集成说明

## 功能概览

当前版本新增了腾讯 SkillHub 的基础接入能力：

- 技能目录展示（支持关键词搜索）
- 技能安装状态展示（未安装 / 已安装 / 可更新）
- 一键安装到本地技能目录

## 后端接口

### 1) 查询腾讯 SkillHub 列表

- `GET /api/skillhub/tencent/skills`
- Query：
  - `query`（可选）：搜索关键词
  - `limit`（可选）：返回数量，默认 `20`

返回示例：

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

### 2) 一键安装腾讯 SkillHub 技能

- `POST /api/skillhub/tencent/install`
- Body：
  - `slug`（必填）：技能标识
  - `version`（可选）：指定版本，不传默认最新
  - `force`（可选）：是否覆盖安装

返回示例：

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## 配置

当前支持以下配置来源（优先级从高到低）：

1. 环境变量：
   - `TENCENT_SKILLHUB_BASE_URL`
   - `TENCENT_SKILLHUB_TOKEN`
2. `~/.squid/config.json` 中的：
   - `model.skillhub.tencent.baseUrl`
   - `model.skillhub.tencent.token`
   - 或 `model.tencentSkillHub.baseUrl` / `token`
3. 默认地址：`https://skillhub.tencent.com/api/v1`

## 本地元数据

安装来源与锁文件会写入：

- `~/.squid/skillhub/tencent/lock.json`
- `~/.squid/skillhub/tencent/origins/<slug>.json`

## 故障排查

- **列表为空**：检查 `baseUrl` 是否可访问，确认搜索关键词是否过窄。
- **安装失败（包结构无效）**：确认 SkillHub 返回包中包含 `SKILL.md`。
- **重复安装失败**：使用 `force: true` 重新安装，或先删除本地同名技能目录。

与技能目录、界面相关的用户说明见 [user-guide.md](./user-guide.md)。
