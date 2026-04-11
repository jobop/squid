# 核心工具使用指南

本文档介绍 squid 中新增的 10 个核心工具的用法和限制。

## 1. FileEditTool (file_edit)

**功能**：精确替换文件内容，使用字符串匹配查找并替换。

**输入参数**：

- `file_path` (string)：要编辑的文件路径
- `old_string` (string)：要替换的旧字符串
- `new_string` (string)：替换后的新字符串
- `replace_all` (boolean，可选)：是否替换所有匹配项（默认 false）

**使用示例**：

```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**限制**：

- 如果找到多处匹配且未设置 `replace_all=true`，会返回错误
- 使用精确字符串匹配，不支持正则表达式

---

## 2. BashTool (bash)

**功能**：执行 Bash 命令，支持超时控制和后台运行。

**输入参数**：

- `command` (string)：要执行的 Bash 命令
- `working_directory` (string，可选)：工作目录
- `timeout` (number，可选)：超时时间（毫秒），默认 30000
- `run_in_background` (boolean，可选)：是否在后台运行

**使用示例**：

```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**限制**：

- 不支持交互式命令
- 后台任务不持久化，重启后丢失
- 标记为破坏性操作，需要用户信任

---

## 3. PowerShellTool (powershell)

**功能**：执行 PowerShell 命令（仅限 Windows 平台）。

**输入参数**：

- `command` (string)：要执行的 PowerShell 命令
- `working_directory` (string，可选)：工作目录
- `timeout` (number，可选)：超时时间（毫秒），默认 30000
- `run_in_background` (boolean，可选)：是否在后台运行

**使用示例**：

```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**限制**：

- 仅在 Windows 平台可用
- 非 Windows 平台会返回错误

---

## 4. WebSearchTool (web_search)

**功能**：使用 DuckDuckGo 搜索网页，返回搜索结果列表。

**输入参数**：

- `query` (string)：搜索查询
- `max_results` (number，可选)：最大结果数量（默认 10，最多 10）

**使用示例**：

```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**限制**：

- 依赖 DuckDuckGo HTML 页面结构，可能因网站改版失效
- 不需要 API 密钥，但结果质量可能不如付费 API
- 最多返回 10 条结果

---

## 5. Cron 工具组

### 5.1 CronCreateTool (cron_create)

**功能**：创建定时任务。

**输入参数**：

- `cron_expression` (string)：Cron 表达式（如 `"0 * * * *"` 表示每小时）
- `task_content` (string)：任务内容描述

**使用示例**：

```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "每天早上 9 点执行备份"
}
```

### 5.2 CronDeleteTool (cron_delete)

**功能**：删除指定的定时任务。

**输入参数**：

- `task_id` (string)：要删除的任务 ID

### 5.3 CronListTool (cron_list)

**功能**：列出所有定时任务。

**输入参数**：无

**限制**：

- 任务存储在内存中，重启后丢失
- 不支持持久化（后续版本可能添加）

---

## 6. SkillTool (skill)

**功能**：调用已注册的技能（预定义的任务模板）。

**输入参数**：

- `skill_name` (string)：技能名称
- `args` (string，可选)：传递给技能的参数

**使用示例**：

```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**限制**：

- 只能调用标记为 `user-invocable: true` 的技能
- 技能文件需要存放在 `~/.squid/skills/` 目录
- 技能执行依赖模型配置（`~/.squid/config.json`）
- 技能执行会走统一执行链路，可能触发工具调用

---

## 7. BriefTool (brief)

**功能**：生成内容摘要，支持多种摘要类型。

**输入参数**：

- `content` (string)：要生成摘要的内容
- `prompt` (string，可选)：自定义提示
- `type` (enum，可选)：摘要类型 — `brief`（简短）、`detailed`（详细）、`bullet_points`（要点列表）

**使用示例**：

```typescript
{
  content: "长篇文章内容...",
  type: "bullet_points"
}
```

**限制**：

- 需要配置 `ANTHROPIC_API_KEY` 环境变量
- 内容超过 50000 字符会被截断
- 依赖外部 API，可能产生费用

---

## 8. AgentTool (agent)

**功能**：创建子代理执行复杂任务，子代理有独立的上下文。

**输入参数**：

- `instruction` (string)：要执行的任务指令
- `timeout` (number，可选)：超时时间（毫秒），默认 300000（5 分钟）

**使用示例**：

```typescript
{
  instruction: "分析项目中的所有 TypeScript 文件，找出潜在的性能问题",
  timeout: 600000
}
```

**限制**：

- 依赖模型配置（`~/.squid/config.json`）
- 默认超时 5 分钟，可通过 `timeout` 自定义
- 通过统一执行链路运行，返回结构化元信息（执行器、模式、工作目录、耗时）

---

## 工具属性说明

每个工具都有以下属性：

- **isConcurrencySafe**：是否可以并发执行
- **isReadOnly**：是否只读操作
- **isDestructive**：是否破坏性操作（可能修改系统状态）

## 结果持久化

所有工具都实现了 `mapToolResultToToolResultBlockParam` 方法，支持结果持久化：

- 当结果超过 `maxResultSizeChars` 限制时，会自动保存到磁盘
- 返回结果预览，避免消耗过多上下文

实现规范见 [tool-development-guide.md](./tool-development-guide.md)。

## 安全注意事项

1. **BashTool 和 PowerShellTool**：可以执行任意系统命令，使用时需要谨慎
2. **FileEditTool**：会直接修改文件，建议在版本控制下使用
3. **BriefTool 和 AgentTool**：会调用外部 API，注意保护 API 密钥
4. **WebSearchTool**：抓取的内容可能包含恶意代码，使用时需要验证

## 测试覆盖

所有工具都有完整的单元测试：

- 正常场景测试
- 边界条件测试
- 错误处理测试
- 接口合规性测试

运行测试：

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
