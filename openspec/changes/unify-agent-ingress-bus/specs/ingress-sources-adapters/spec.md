## ADDED Requirements

### Requirement: Cron 触发的 Agent 执行应通过入站队列

在启用本 change 对应实现时，由定时任务触发的、意图调用 `TaskAPI` 执行用户配置 prompt 的路径 SHALL 通过入站队列投递作业，而非在 cron 回调中直接调用 `executeTask`（除非功能开关显式关闭队列模式）。

#### Scenario: Cron  fire 产生入队作业

- **WHEN** 已注册的 cron 表达式触发且任务执行器被调用
- **THEN** 系统 SHALL 构造带有 `source` 标明为定时任务（如 `cron`）的作业并入队，由消费者调用任务 API

### Requirement: 飞书入站应在适配层转入队

飞书（或其它使用 `channel:inbound` 的渠道）在将用户文本交给 Agent 执行时，SHALL 通过入站队列适配层入队；`emitChannelInbound` 可保留用于解码与审计，但执行请求 SHALL 经队列消费统一出口（除非功能开关关闭队列模式）。

#### Scenario: channel:inbound 转化为入队

- **WHEN** 合法飞书入站事件经 EventBridge 或等价入口到达适配层
- **THEN** 适配层 SHALL 生成作业项（含 `source` 与渠道标识、`conversationId` 若可推导）并入队

### Requirement: HTTP 执行路径须在设计与任务中明确策略

本能力要求在 `design.md` / `tasks.md` 中 **明确记载** HTTP（含 SSE）是否纳入首期入队范围。若首期排除 SSE，则 SHALL 在提案或任务中说明理由与用户可见行为无回归；若纳入，则 SHALL 定义客户端断开时作业取消或完成策略的最小语义。

#### Scenario: 文档与实现一致

- **WHEN** 审阅者阅读 `tasks.md` 中 HTTP 相关条目
- **THEN** 可见明确勾选或陈述「HTTP/SSE 入队 / 不入队」及对应验收方式
