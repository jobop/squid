## Context

`squid` 已有本地技能读取、预览与安装基础接口（`TaskAPI.listSkills / previewSkill / installSkill`），但缺少“远程技能市场”能力。`openclaw-main` 在 `skills-clawhub.ts` 中已经形成较完整模式：远程搜索、安装、来源元数据（origin）、锁文件（lock）和更新路径。  

本次设计目标是在不破坏现有本地技能能力的前提下，引入“腾讯 SkillHub 浏览 + 一键安装”链路，并保留后续升级/更新能力的扩展空间。

## Goals / Non-Goals

**Goals:**
- 提供腾讯 SkillHub 列表查询能力（支持搜索、分页/limit、基础元信息展示）。
- 提供一键安装能力（按技能 slug + 版本可选，安装到本地 skills 目录）。
- 记录安装来源和版本信息（参考 `openclaw-main` 的 origin/lock 思路）。
- 给 UI 提供明确的安装状态反馈（进行中、成功、失败原因）。

**Non-Goals:**
- 本次不做完整“升级全部已安装技能”的自动更新系统。
- 本次不引入复杂权限系统或沙箱执行模型（保持现有边界）。
- 本次不替换现有本地 `installSkill`/`previewSkill`，仅新增 SkillHub 路径。

## Decisions

### Decision 1: 新增独立 SkillHub 服务层，避免把远程逻辑塞进 TaskAPI

- 方案：在 `src/skills/` 下新增腾讯 SkillHub 相关模块（client/install/status），`TaskAPI` 仅作为 API 编排入口。
- 原因：职责清晰，可单测，可复用。
- 备选：
  - 直接在 `TaskAPI` 里拼网络请求和安装逻辑：实现快但可维护性差。

### Decision 2: 采用“下载归档 -> 解压校验 -> 安装目录写入”流程

- 方案：参考 `skills-clawhub.ts`，安装流程采用可恢复的阶段式处理，安装前校验 skill 包内是否存在核心文件（如 `SKILL.md`）。
- 原因：比直接写文件更安全，便于错误定位与未来更新能力复用。
- 备选：
  - 直接下载单文件覆盖：简单但不适配技能目录结构和版本管理。

### Decision 3: 增加来源追踪元数据与锁文件

- 方案：在本地维护 `origin`（每个技能来源信息）与 `lock`（工作区已安装版本映射）数据。
- 原因：后续做升级、去重、冲突诊断需要来源和版本证据链。
- 备选：
  - 不记录来源：短期可用，但后续升级能力和排障成本高。

### Decision 4: API 采用显式市场接口，不复用现有 preview/install 参数模型

- 方案：新增 `listTencentSkillHubSkills`、`installTencentSkillHubSkill` 等方法及路由，和本地安装接口并行。
- 原因：语义清楚，避免把远程市场参数硬塞给本地接口导致歧义。
- 备选：
  - 复用 `installSkill(data:any)`：会弱类型化并放大维护风险。

## Risks / Trade-offs

- [风险] 腾讯 SkillHub API 失败或限流影响用户体验  
  → Mitigation: 增加超时与可读错误码映射，前端展示可重试提示。

- [风险] 远程安装包内容异常导致安装中断  
  → Mitigation: 安装前做目录与关键文件校验，失败不污染目标目录。

- [风险] 本地已有同名技能覆盖冲突  
  → Mitigation: 默认拒绝覆盖，提供 `force` 参数并明确提示风险。

## Migration Plan

1. 新增 SkillHub client + 安装模块 + 状态元数据模块。
2. 扩展 `TaskAPI` 和后端路由，暴露市场查询与一键安装接口。
3. 前端新增“腾讯 SkillHub”列表与安装按钮，接入安装结果提示。
4. 添加单测与最小集成验证（列表获取 + 安装成功/失败）。
5. 灰度验证后启用默认入口；如异常可回退到仅本地技能模式。

## Open Questions

- 腾讯 SkillHub 是否需要认证 token（如果需要，配置放 `~/.squid/config.json` 还是独立配置）？
- 技能唯一键采用 `slug` 还是 `slug@version` 作为本地目录命名策略？
