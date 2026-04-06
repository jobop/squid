## ADDED Requirements

### Requirement: 系统应提供进程内 Agent 入站队列与单消费者

系统 SHALL 提供可注入的入站队列组件，用于接收代表「一次 Agent 执行请求」的作业项，并由 **单一逻辑消费者** 按策略出队并调用任务执行 API（如 `TaskAPI`）。队列 SHALL 支持至少一种优先级比较规则，使高优先级作业先于低优先级作业被消费（同优先级 FIFO）。

#### Scenario: 入队后按优先级出队

- **WHEN** 两个作业已入队且作业 A 的优先级高于作业 B
- **THEN** 消费者在未受取消/超时干预时 SHALL 先处理作业 A 再处理作业 B

#### Scenario: 同优先级 FIFO

- **WHEN** 两个作业优先级相同且先后入队
- **THEN** 消费者 SHALL 先处理先入队的作业

### Requirement: 作业项应携带可追溯字段

每个入队作业 SHALL 包含：稳定可追溯的 `jobId`（或由系统生成）、`instruction`（或等价载荷）、`source`（来源标识，如 `cron`、`channel:feishu`、`http`）。SHALL 支持可选的 `conversationId` 与优先级字段，以便与会话管理与渠道行为对齐。

#### Scenario: 消费时可记录来源

- **WHEN** 消费者开始处理某一作业
- **THEN** 系统 SHALL 能根据作业项中的 `source` 与 `jobId` 记录日志或遥测（若项目已启用日志）

### Requirement: 消费者不得阻塞事件总线线程

入队操作 SHALL 为同步或短时异步；长时间执行 SHALL 发生在消费者异步流程中，且 SHALL NOT 在 `EventBridge.emit` 的同步回调栈内直接执行完整 LLM 任务（若接入 EventBridge，适配层 SHALL 仅投递队列后立即返回）。

#### Scenario: 飞书 inbound 仅投递队列

- **WHEN** 适配层收到 `channel:inbound` 事件并转化为作业入队
- **THEN** 该回调路径 SHALL 在入队完成后立即返回，不等待 `TaskAPI` 整轮执行结束
