## Context

- 已有 [`EventBridge`](src/channels/bridge/event-bridge.ts)：`task:complete`、`command`、`channel:inbound`（EventEmitter + `globalThis` 单例），用于 Channel 与引擎之间的 **事件通知**，不是有序入站队列。
- 当前触发 `TaskAPI` 的路径包括：[`bun/index.ts`](src/bun/index.ts) 的 HTTP、`cronManager.setTaskExecutor`、飞书 [`squid-bridge`](extensions/feishu/src/squid-bridge.ts) 订阅 `channel:inbound` 等，**无统一优先级与单点消费**。
- 参考 claude-code-main：模块级 `commandQueue` + `QueuedCommand.agentId` 过滤 + 子 Agent `pendingMessages` 等为 **不同问题域** 的组合方案；squid 首期只需解决 **「外部/调度触发的单次执行任务」** 的收敛，不必复制其 UI/多 Agent 状态机。

## Goals / Non-Goals

**Goals:**

- 定义 **入站作业（IngressJob）** 的统一结构：来源、`conversationId`（若有）、instruction、优先级、可选 deadline、可追溯 id。
- **单消费者** 从队列取出作业并调用现有 `TaskAPI.executeTask` / `executeTaskStream`（流式适配见下），保证同一时刻对「队列驱动」路径的 **串行或可控并发**（实现阶段二选一并在 spec 中写死默认）。
- 与 EventBridge 的边界：**飞书等仍可 `emitChannelInbound`**；**适配层** 将事件转为 `IngressJob` 入队，避免业务插件直接绑死 `TaskAPI`。
- 可测试：纯函数或注入式 `TaskAPI`，单测覆盖优先级与出队顺序。

**Non-Goals:**

- 首期 **不** 把子 Agent 工具调用链改为异步总线。
- **不** 要求与 claude-code-main 的 `QueuedCommand` / `processQueueIfReady` API 级一致。
- **不** 默认引入 Redis/磁盘持久化队列（除非后续 change）。

## Decisions

1. **新模块 vs 扩展 EventBridge**  
   **决策**：新建 **Ingress 队列服务**（进程内），EventBridge 保持「事件」语义。  
   **理由**：避免在 EventEmitter 上叠队列语义导致 `emit` 与「有序、可取消」混用；与现有 channel 文档一致可渐进迁移。

2. **HTTP SSE 路径**  
   **决策**：首期二选一并在实现前在 `tasks.md` 勾选：(A) SSE 仍直连 `executeTaskStream`，仅 Cron+飞书入队；(B) SSE 也入队，由消费者建立「占位流」向客户端写 chunk。  
   **默认建议**：(A) 降低风险；(B) 作为二期。  
   **理由**：(B) 需处理客户端断开与队列项生命周期，复杂度高。

3. **优先级维度**  
   **决策**：至少支持 **显式优先级枚举**（如 `user`、`scheduled`、`channel`）与 **FIFO**；同优先级内 FIFO。可选：按 `conversationId` 公平（轮询）作为二期。  
   **理由**：满足「用户输入优先于定时骚扰」的常见需求，且实现简单。

4. **与 `channel:inbound` 的衔接**  
   **决策**：`registerFeishuSquidBridge` 改为调用 `ingressQueue.enqueue(...)`，消费者内再调 `TaskAPI`；或保留桥接文件但内部只入队。  
   **理由**：单一消费出口，飞书重试与 Cron 可在队列层统一限流（后续）。

## Risks / Trade-offs

- **[Risk] 入队增加延迟** → 默认优先级下用户感知极小；SSE 若入队则需监控排队时间。  
- **[Risk] 消费者崩溃导致队列堆积** → 进程内队列随进程重启丢失；接受为首期 trade-off，文档标明。  
- **[Risk] 与现有 `busyChats` 等去重逻辑重复** → 设计保留飞书侧去重，队列层可选幂等 key，避免双写冲突。  
- **[Risk] 死锁：消费者等待自身产生的同步入队** → 消费者内禁止同步入队同队列；Cron 回调仅投递异步。

## Migration Plan

1. 引入队列与消费者循环（可先无业务接入）。  
2. 接入 Cron → 队列 → TaskAPI。  
3. 接入飞书桥接。  
4. （可选）HTTP 路径。  
5. 文档与 [`docs/integration-testing.md`](docs/integration-testing.md) 补充一条集成场景。

回滚：开关配置「禁用入队、恢复直连」（实现时增加 feature flag 或环境变量）。

## Open Questions

- 消费者 **严格串行** vs **按 conversationId 并行、全局仍限并发**：需结合 `TaskAPI` 线程安全与产品期望再定。  
- 是否暴露 **队列深度** 指标给渠道健康检查页面。
