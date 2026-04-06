## Why

定时任务和后台执行的结果目前只输出到控制台，用户在聊天界面无法收到通知。需要建立一个简单的双向通信机制，让：
1. OpenClaw 的飞书插件能直接在 squid 上运行
2. 聊天框改造成插件，与引擎双向通信
3. 所有 channel（聊天框、飞书等）都能接收任务通知和发送命令

## What Changes

- 创建简单的事件总线（EventBridge），连接引擎和 channel
- 将聊天框改造为 WebUIChannelPlugin
- 提供最小化的 OpenClaw 插件适配层，让飞书插件能运行
- 定时任务/后台任务完成时，通过事件总线通知到所有 channel
- Channel 可以通过事件总线发送命令到引擎

## Capabilities

### New Capabilities

- `event-bridge`: 简单的事件总线，连接引擎和 channel 的双向通信
- `webui-channel-plugin`: 将聊天框改造为标准 channel 插件
- `openclaw-plugin-adapter`: 最小化适配层，让 OpenClaw 飞书插件能运行

### Modified Capabilities

- `scheduler`: 扩展调度器，任务完成时发送事件到 EventBridge
- `task-execution`: 扩展任务执行，完成时发送事件到 EventBridge

## Impact

**新增模块：**
- `src/channels/bridge/` - 简单的事件总线
- `src/channels/plugins/webui/` - WebUI channel 插件
- `src/channels/openclaw-adapter/` - OpenClaw 插件最小化适配层

**修改模块：**
- `src/channels/types.ts` - 添加事件类型定义
- `src/channels/registry.ts` - 支持插件注册和事件订阅
- `src/scheduler/` - 集成事件总线，发送任务完成事件
- `src/tasks/` - 集成事件总线，发送任务完成事件

**依赖变更：**
- 添加 `ws` 库用于 WebSocket（WebUI channel）
- 可能需要 OpenClaw 飞书插件的部分依赖

**兼容性：**
- 现有功能保持不变
- 新增的事件通知是额外功能
