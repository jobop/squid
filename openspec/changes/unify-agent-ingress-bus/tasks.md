## 1. 类型与队列核心

- [ ] 1.1 定义 `IngressJob`（或等价）类型：`jobId`、`instruction`、`source`、`priority`、`conversationId?`、时间戳等，放在 `src/` 下新目录（如 `src/ingress/`）或经团队认可的现有模块
- [ ] 1.2 实现进程内优先级队列（同优先级 FIFO），暴露 `enqueue(job)`、`startConsumer(taskAPI)`、`stopConsumer()`（或生命周期由 `bun/index` 托管）
- [ ] 1.3 消费者内调用 `TaskAPI.executeTask` 或 `executeTaskStream`；错误日志与不应吞掉未处理异常（避免静默丢作业）
- [ ] 1.4 单元测试：优先级顺序、同优先级 FIFO、消费者 mock `TaskAPI`

## 2. Cron 适配

- [ ] 2.1 将 [`bun/index.ts`](src/bun/index.ts) 中 `cronManager.setTaskExecutor` 改为投递 `IngressJob`（`source: cron`），由消费者执行原 `executeTask` 逻辑
- [ ] 2.2 验证至少一条 cron 集成/手测路径仍返回预期结果

## 3. 飞书 / channel:inbound 适配

- [ ] 3.1 调整 [`extensions/feishu/src/squid-bridge.ts`](extensions/feishu/src/squid-bridge.ts)（或集中注册点）：`onChannelInbound` 中构造 `IngressJob` 并入队，移除或条件编译「直连 `executeTaskStream`」路径（由功能开关控制回滚）
- [ ] 3.2 保留现有 `busyChats` 等去重语义，避免与队列层行为冲突
- [ ] 3.3 单测或契约测试：`emitChannelInbound` → 入队 → consumer 调用 mock

## 4. HTTP 策略与文档

- [ ] 4.1 在实现中 **二选一并落代码注释**：首期 HTTP `/api/task/execute-stream` 保持直连 **或** 改为入队；在 `tasks.md` 本节前勾选项旁写明最终选择
- [ ] 4.2 若保持 SSE 直连：在 [`docs/integration-testing.md`](docs/integration-testing.md) 或本 change 的 `design.md` 交叉引用中说明「HTTP 非队列」例外
- [ ] 4.3 若 SSE 入队：定义客户端断开时行为（取消队列项 / 继续跑完）并实现最小逻辑

## 5. 可观测与收尾

- [ ] 5.1 队列深度/丢弃/失败的关键路径打结构化日志（与现有 `[Channels]` / `[CronManager]` 风格一致）
- [ ] 5.2 （可选）环境变量或配置开关 `INGRESS_QUEUE_ENABLED` 用于一键回退直连
- [ ] 5.3 `npx vitest run` 相关用例全绿；更新 CHANGELOG 或团队约定的发布说明（若项目要求）
