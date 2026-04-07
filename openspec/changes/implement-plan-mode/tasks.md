## M1 — Plan 模式最小可用

- [x] 1.1 `TaskExecutor`：`executeStream` / `callOpenAIAPIStream`（及仍在使用的非流式 `callOpenAIAPI`）传入 `request.mode`；`buildMessages(instruction, workspace, history, mode)` 在 `plan` 时追加规划期系统段落（中文：只读、不改业务文件、结束需用户切 Ask/Craft；M2 实施后补「写入 `.squid/plan.md`」句）。
- [x] 1.2 新建 `plan-mode-policy.ts`（或等价）：导出 `getToolsForTaskMode(mode, registry)`、`isToolInvocationAllowedInPlanMode(toolName, args, workspace)`（M1 阶段可仅校验 toolName）。
- [x] 1.3 组 `tools` 参数时使用 `getToolsForTaskMode`；`plan` 为显式白名单（read_file、glob、grep、web_fetch、web_search、brief、cron_list 等），**排除** file_edit、write_file、bash、powershell、agent、skill、cron_create、cron_delete、save_memory（首期全排除，避免 input 依赖）。
- [x] 1.4 每次工具调用前：若 `mode === 'plan'` 且不允许，不调用 `tool.call`，向 messages 写入错误 tool_result（说明当前为 Plan 模式）。
- [x] 1.5 所有 `tool.call` 传入真实 `context.mode`（替换写死 `'ask'`）。
- [x] 1.6 测试：`plan` 下 tools 列表快照或包含关系；模拟非法 tool 调用返回错误；`ask`/`craft`  smoke。

## M2 — 工作区内计划文件

- [x] 2.1 实现 `getCanonicalPlanFilePath(workspace, conversationId?)` 与路径规范化/防穿越工具函数；默认 `<workspace>/.squid/plan.md`（或带会话后缀，与 design 定稿一致）。
- [x] 2.2 将 `write_file`、`file_edit` 加入 plan 下工具列表，但 **执行闸** 仅当目标路径等于 canonical 计划路径时允许；否则拒绝。
- [x] 2.3 `write_file` 创建前确保父目录 `.squid` 存在（仅当路径为计划路径时）。
- [x] 2.4 更新 `buildMessages` plan 段：写明计划文件绝对路径与唯一写出口约定。
- [x] 2.5 测试：plan 下写计划文件成功；写 `src/foo.ts` 失败；`..` 穿越失败。
- [x] 2.6 （可选）`public/index.html` Plan 选项旁简短说明计划文件位置与切换模式提示。

## M3 — 多 Agent 并行（可选）

- [ ] 3.1 ~~JSON 并行块 + 专用 API~~ **已回滚**；改为 Plan 内 **提示词引导 + 同轮多工具/`agent` 并发探索**（见 `specs/task-plan-mode/spec.md` 更新条）。
- [ ] 3.2 ~~parseParallelTracks~~ 删除；以 executor 并行执行与 plan-mode-policy 单测为准。
- [ ] 3.3 ~~Craft 专用 parallel-plan-run~~ 删除；并行探索发生在 **Plan 模式对话内**。
- [ ] 3.4 文档：共享 workspace、子 `agent` 继承 plan 约束；汇总由主模型在下一轮完成。
