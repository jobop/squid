## Why

当前 `squid` 的技能能力以本地管理为主，缺少类似 `openclaw-main` `skills-clawhub` 的“远程市场浏览 + 一键安装”闭环。接入腾讯 SkillHub 后，用户可以直接发现并安装技能，降低技能使用门槛并提升生态扩展速度。

## What Changes

- 新增腾讯 SkillHub 集成能力：支持按关键词拉取并展示技能列表（名称、描述、版本、来源、安装状态）。
- 新增一键安装流程：用户可从列表直接安装指定腾讯 SkillHub 技能到本地技能目录。
- 新增安装来源追踪与状态管理（参考 `skills-clawhub` 的 origin/lock 思路），用于后续升级、去重和诊断。
- 新增面向 UI/API 的接口：支持技能市场查询、安装执行、安装结果反馈。
- 补充测试与文档，确保安装成功/失败与异常场景行为可验证。

## Capabilities

### New Capabilities
- `tencent-skillhub-catalog`: 从腾讯 SkillHub 拉取并展示技能目录，支持搜索与状态展示。
- `tencent-skillhub-installation`: 支持从腾讯 SkillHub 一键安装技能，并记录安装来源与版本信息。

### Modified Capabilities
- （无）

## Impact

- Affected code:
  - `src/api/task-api.ts`（新增 SkillHub 相关 API）
  - `src/skills/*`（新增 SkillHub 客户端、安装与状态管理模块）
  - `src/ui/*` 或 `public/index.html`（技能市场展示与一键安装交互）
  - `src/__tests__/*`（SkillHub 列表与安装流程测试）
- Reference implementation:
  - `openclaw-main/src/agents/skills-clawhub.ts`
  - `openclaw-main/src/agents/skills-status.ts`
  - `openclaw-main/src/agents/skills-install.ts`
- Dependencies / system:
  - 可能新增腾讯 SkillHub API 调用配置（基础 URL、认证信息）
  - 技能安装目录与来源元数据存储将新增管理文件
