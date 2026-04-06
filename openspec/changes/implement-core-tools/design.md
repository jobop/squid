## Context

当前 squid 只有 6 个基础工具（ReadFile, WriteFile, Glob, Grep, SaveMemory, WebFetch），功能相对有限。claude-code-main 拥有 40+ 个成熟工具，涵盖文件操作、命令执行、网络访问、任务管理等多个领域。

本次设计目标是补齐 10 个核心工具，提升系统的实用性。这些工具都是独立的，不涉及架构变更，可以逐个实现和测试。

## Goals / Non-Goals

**Goals:**
- 实现 10 个核心工具，每个工具符合现有 Tool 接口规范
- 所有工具都实现 mapToolResultToToolResultBlockParam 方法
- 所有工具都支持结果持久化（设置合理的 maxResultSizeChars）
- 参考 claude-code-main 的实现，但根据项目需求简化
- 确保工具的并发安全性和只读/破坏性标记正确

**Non-Goals:**
- 不实现复杂的权限系统（简化版本，信任用户）
- 不实现 UI 组件（专注后端逻辑）
- 不实现所有 claude-code-main 的高级特性（如 LSP、MCP 集成等）
- WebSearchTool 暂不集成真实搜索 API（返回模拟数据或使用简单的 DuckDuckGo）

## Decisions

### 1. 工具实现优先级
**决策**: 按功能重要性和实现复杂度排序

**优先级**:
1. **FileEditTool** - 最常用，替换 WriteFile 的主要场景
2. **BashTool** - 命令执行是基础能力
3. **CronTools** (Create/Delete/List) - 定时任务管理
4. **SkillTool** - 集成现有技能系统
5. **WebSearchTool** - 补充 WebFetch
6. **PowerShellTool** - Windows 支持（优先级较低）
7. **BriefTool** - 摘要生成
8. **AgentTool** - 子代理调用（最复杂）

**理由**: 先实现高频使用的工具，后实现复杂或平台特定的工具

### 2. FileEditTool 实现方式
**决策**: 使用字符串精确匹配替换

**方案**:
- 输入: `file_path`, `old_string`, `new_string`, `replace_all` (可选)
- 读取文件内容，查找 `old_string`
- 如果找到多处且 `replace_all=false`，返回错误要求更精确的匹配
- 替换后写回文件

**替代方案**:
- 基于行号的替换 - 不够灵活，行号容易变化
- 正则表达式替换 - 过于复杂，容易出错

### 3. BashTool 安全策略
**决策**: 简化版本，不实现沙箱隔离

**方案**:
- 使用 Node.js `child_process.spawn` 执行命令
- 支持超时控制（默认 30 秒）
- 支持后台运行（返回任务 ID）
- 捕获 stdout 和 stderr

**风险**: 用户可以执行任意命令，需要信任用户

**缓解**: 
- 在文档中明确说明安全风险
- 后续可添加命令白名单或黑名单

### 4. WebSearchTool 实现方式
**决策**: 第一版使用 DuckDuckGo HTML 抓取，不依赖付费 API

**方案**:
- 使用 axios 请求 DuckDuckGo 搜索页面
- 解析 HTML 提取搜索结果（标题、链接、摘要）
- 返回前 10 条结果

**替代方案**:
- Google Custom Search API - 需要 API 密钥，有配额限制
- Bing Search API - 同样需要付费
- SerpAPI - 第三方服务，需要付费

**理由**: DuckDuckGo 免费且不需要 API 密钥，适合快速实现

### 5. Cron 工具实现
**决策**: 使用已安装的 `node-cron` 库

**方案**:
- CronCreateTool: 创建定时任务，存储到内存 Map
- CronDeleteTool: 根据任务 ID 删除
- CronListTool: 列出所有任务

**持久化**: 第一版不持久化，重启后任务丢失（后续可添加）

### 6. SkillTool 集成
**决策**: 调用现有的 SkillLoader

**方案**:
- 输入: `skill_name`, `args`
- 通过 SkillLoader 加载技能
- 执行技能并返回结果

**理由**: 项目已有 SkillLoader，直接复用

### 7. BriefTool 实现
**决策**: 调用 AI 模型生成摘要

**方案**:
- 输入: `content`, `prompt` (可选)
- 调用配置的 AI 模型（OpenAI/Anthropic）
- 返回摘要结果

**限制**: 依赖用户配置的 API 密钥

### 8. AgentTool 实现
**决策**: 简化版本，创建独立的 TaskExecutor 实例

**方案**:
- 输入: `instruction`, `context`
- 创建新的 TaskExecutor 实例
- 执行任务并返回结果
- 支持超时控制

**与 claude-code-main 的区别**: 不实现复杂的代理通信和状态管理

## Risks / Trade-offs

### 风险 1: BashTool 安全风险
**风险**: 用户可以执行任意系统命令，可能造成破坏

**缓解**:
- 标记为 `isDestructive: true`
- 在文档中明确说明
- 后续可添加命令审核机制

### 风险 2: WebSearchTool 稳定性
**风险**: HTML 抓取依赖页面结构，DuckDuckGo 改版会导致失效

**缓解**:
- 添加错误处理，解析失败时返回友好错误
- 后续可切换到付费 API
- 提供配置选项让用户选择搜索引擎

### 风险 3: Cron 任务不持久化
**风险**: 重启后定时任务丢失

**缓解**:
- 在文档中说明限制
- 后续版本添加持久化到文件

### 风险 4: 工具数量增加导致维护成本上升
**风险**: 10 个新工具需要持续维护和测试

**缓解**:
- 每个工具都有完整的测试用例
- 参考 claude-code-main 的成熟实现，减少 bug
- 优先实现高频使用的工具

### Trade-off: 功能 vs 复杂度
**权衡**: 简化实现以快速交付，牺牲部分高级特性

**选择**: 接受功能限制，优先快速交付可用版本，后续迭代优化

## Migration Plan

### 实施步骤
1. 按优先级逐个实现工具（FileEdit → Bash → Cron → Skill → WebSearch → 其他）
2. 每个工具实现后立即编写测试用例
3. 在 task-api.ts 中注册工具
4. 更新文档说明新工具的用法

### 测试计划
- 每个工具至少 5 个测试用例（正常、边界、错误）
- 集成测试：验证工具在 TaskExecutor 中正常工作
- 手动测试：通过 API 调用验证实际效果

### 回滚策略
- 新工具独立，不影响现有功能
- 如有问题，从 registry 移除即可
- 无数据迁移，回滚无风险

## Open Questions

1. **WebSearchTool 是否需要支持多个搜索引擎？**
   - 建议：第一版只支持 DuckDuckGo，后续可扩展

2. **BashTool 是否需要支持交互式命令？**
   - 建议：第一版不支持，只支持非交互式命令

3. **AgentTool 是否需要支持流式输出？**
   - 建议：第一版不支持，直接返回完整结果

4. **Cron 任务是否需要支持分布式？**
   - 建议：不需要，单机版本即可
