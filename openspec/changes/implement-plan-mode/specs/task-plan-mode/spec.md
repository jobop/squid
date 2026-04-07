## ADDED Requirements

### Requirement: Plan 模式工具暴露与执行闸

当任务 `mode` 为 `plan` 时，系统 SHALL 仅向模型暴露规划期允许的工具定义；对任何非允许工具调用 SHALL 在执行前拒绝并返回可读错误信息，且 SHALL NOT 执行对应工具副作用。

#### Scenario: Plan 下列表不含写仓库类工具

- **WHEN** 任务以 `plan` 模式发起流式或非流式执行
- **THEN** 下发给模型的 `tools` 列表不包含 `bash`、`powershell`、`skill`、`cron_create`、`cron_delete`、`save_memory` 等；`file_edit`/`write_file` 仅在满足 M2 计划路径规则时可执行；**允许** `agent` 用于规划期只读/探索向子任务（子执行继承 `plan` 约束）；以 `design.md` 白名单为准

#### Scenario: 模型仍输出禁用工具调用

- **WHEN** `plan` 模式下模型产生非允许 `tool_calls`
- **THEN** 宿主不调用工具实现，并向对话上下文注入说明当前为 Plan 模式的错误结果

#### Scenario: Ask 与 Craft 兼容

- **WHEN** 任务 `mode` 为 `ask` 或 `craft`
- **THEN** 工具列表与改前行为一致（除明确修复的 bug 外无意外缩权）

---

### Requirement: Plan 模式系统说明与 mode 贯通

系统 SHALL 将真实 `TaskMode` 传入消息构建与 `ToolContext.mode`。

#### Scenario: 规划期系统说明

- **WHEN** `mode === 'plan'`
- **THEN** 系统消息中包含固定中文说明：当前为规划阶段、不得修改业务代码或通过非只读手段改变环境、用户需切换至 Ask/Craft 后再实现（M2 补充计划文件路径与唯一写出口）

#### Scenario: ToolContext.mode

- **WHEN** 任意工具在任务执行过程中被调用
- **THEN** `ToolContext.mode` 与当前任务 `mode` 一致，而非写死常量

---

### Requirement: 工作区内计划文件（M2）

`plan` 模式下，系统 SHALL 仅允许向 **当前 workspace 内 canonical 计划文件路径** 进行创建或编辑写入；对所有其他路径的写类工具调用 SHALL 拒绝。

#### Scenario: 写入默认计划文件成功

- **WHEN** `mode === 'plan'` 且工具目标路径为规范化后的 `<workspace>/.squid/plan.md`（或实现选定的带会话后缀的等价路径）
- **THEN** `write_file` 或 `file_edit` 允许执行（在满足既有工具校验前提下）

#### Scenario: 写入业务文件被拒绝

- **WHEN** `mode === 'plan'` 且目标路径为 workspace 内非 canonical 计划路径（例如 `src/app.ts`）
- **THEN** 拒绝执行并返回明确错误

#### Scenario: 路径穿越被拒绝

- **WHEN** `mode === 'plan'` 且参数路径经解析后脱离 workspace 根或不等于 canonical 计划路径
- **THEN** 拒绝执行

---

### Requirement: 全模式同轮安全并行 + 提示词引导

系统消息（各 `TaskMode`）SHALL 包含「同轮工具并行由主模型自行判断」的说明（见 `getParallelToolBatchSystemSection`）；宿主对 **ask / craft / plan** SHALL 按 `partitionToolCalls` + 各工具 `isConcurrencySafe(解析后 input)` 将同轮 `tool_calls` 切成连续段：**连续且均安全**的段可 `Promise.all` 并发；否则顺序执行。对含 `write_file`/`file_edit` 的并发段 SHALL 校验解析后路径在工作区内、写路径两两不同、且不与同段 `read_file` 目标相同，否则该段降级为顺序执行。`bash` 等声明为不可并发的工具与同段其它调用不得并发。

#### Scenario: 同轮多工具并发（任意 mode）

- **WHEN** `mode` 为 `ask`、`craft` 或 `plan`，且连续若干 `tool_calls` 在解析参数后均被对应工具声明为可并发
- **THEN** 宿主对该连续段并发执行，再将各 `tool_result` 按与原始 `tool_calls` 一致的顺序写回上下文

#### Scenario: 不可并发段顺序执行

- **WHEN** 某工具解析失败、`isConcurrencySafe` 为假，或与同段写路径规则冲突而降级
- **THEN** 宿主对该段顺序执行，且 SHALL NOT 静默丢弃工具结果

#### Scenario: Plan 探索与成文

- **WHEN** `mode === 'plan'`
- **THEN** 除上述并行规则外，附录仍约束唯一计划文件写入与探索阶段汇总流程
