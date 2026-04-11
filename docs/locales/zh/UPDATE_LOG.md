# 更新记录

## 2026-04-10

### 新增

- 渠道入站图片识别：Telegram / Feishu / 微信个人号支持将可识别图片保存到 workspace，并通过 `mentions(file)` 注入任务执行。
- 渠道打断命令：新增 `/wtf`，统一走 `TaskAPI.executeTaskStream` 命令分支触发中断。

### 行为变更

- `/wtf` 与 Web ESC 语义对齐：仅中断当前会话正在执行的任务，不清理队列。
- `/wtf` 在 busy 检查之前执行，避免忙状态下命令被误判为普通请求。

### 验证

- 通过 `task-api-execute-stream-slash`、`telegram-squid-bridge`、`feishu-squid-bridge`、`weixin-personal-squid-bridge` 回归测试。
