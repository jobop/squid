# Update log

## 2026-04-10

### Added

- Channel inbound image recognition: Telegram / Feishu / WeChat personal can persist recognizable images into the workspace and inject them via `mentions(file)` for task execution.
- Channel interrupt command: `/wtf`, routed through the `TaskAPI.executeTaskStream` command branch.

### Behavior changes

- `/wtf` matches Web ESC semantics: interrupt only the in-flight task for the current session; the queue is not cleared.
- `/wtf` is evaluated before the busy check so busy sessions still accept immediate interrupts instead of treating the message as a normal queued request.

### Verification

- Regression: `task-api-execute-stream-slash`, `telegram-squid-bridge`, `feishu-squid-bridge`, `weixin-personal-squid-bridge`.
