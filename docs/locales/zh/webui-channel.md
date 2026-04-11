# WebUI Channel 使用文档

## 概述

WebUI Channel 是一个内置的 channel 插件，将聊天界面作为一个标准的 channel 实现，通过 WebSocket 实现与执行引擎的双向通信。

在应用侧栏进入 **「渠道」** 可查看包含 WebUI 在内的 Channel 列表与健康状态；WebUI 详情为只读说明，无 Web 端写配置入口。

## 功能特性

- 实时接收任务完成通知  
- 支持从聊天界面发送命令  
- WebSocket 自动重连  
- 心跳检测保持连接  
- 多客户端支持  

## 架构

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│  前端页面   │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (浏览器)    │                           │   (后端)         │
└─────────────┘                           └──────────────────┘
                                                    │
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │   执行引擎       │
                                          │(CronManager/Tasks)│
                                          └──────────────────┘
```

## 配置

### 服务端配置

在 `config/channels.json` 中配置：

```json
{
  "channels": {
    "webui": {
      "enabled": true,
      "port": 8080,
      "heartbeatInterval": 30000
    }
  }
}
```

**配置项说明：**

- `enabled` — 是否启用 WebUI Channel
- `port` — WebSocket 服务器端口（默认 8080）
- `heartbeatInterval` — 心跳间隔（毫秒，默认 30000）

### 前端配置

WebSocket 客户端会自动连接到 `ws://localhost:8080`。

如果需要修改连接地址，在 `public/websocket-client.js` 中修改：

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## 使用方法

### 1. 启动应用

WebUI Channel 会在应用启动时自动初始化：

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### 2. 接收任务通知

前端会自动接收任务完成通知并显示在聊天界面：

```javascript
// 已在 index.html 中自动注册
window.wsClient.on('task:complete', (event) => {
  // 显示通知
  showTaskNotification(event);
});
```

### 3. 发送命令

从前端发送命令到执行引擎：

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## 消息格式

### 服务端 → 客户端

#### 任务完成通知

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "数据处理任务",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

#### 通用通知

```json
{
  "type": "notification",
  "data": {
    "title": "系统通知",
    "content": "操作成功",
    "type": "success"
  }
}
```

#### 心跳

```json
{
  "type": "ping"
}
```

### 客户端 → 服务端

#### 发送命令

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

#### 心跳响应

```json
{
  "type": "pong"
}
```

## API 参考

### WebSocketClient（前端）

#### connect()

连接到 WebSocket 服务器。

```javascript
window.wsClient.connect();
```

#### disconnect()

断开连接。

```javascript
window.wsClient.disconnect();
```

#### send(type, data)

发送消息。

```javascript
window.wsClient.send('command', { command: 'test', args: {} });
```

#### sendCommand(command, args)

发送命令（快捷方法）。

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

#### on(type, handler)

注册消息处理器。

```javascript
window.wsClient.on('task:complete', (event) => {
  console.log('任务完成:', event);
});
```

#### off(type, handler)

移除消息处理器。

```javascript
window.wsClient.off('task:complete', handler);
```

#### isConnected()

检查连接状态。

```javascript
if (window.wsClient.isConnected()) {
  console.log('已连接');
}
```

## 故障排查

### 连接失败

1. 检查 WebSocket 服务器是否启动
2. 检查端口是否被占用
3. 查看浏览器控制台错误信息

### 消息未收到

1. 检查 WebSocket 连接状态
2. 检查 EventBridge 是否正确发送事件
3. 查看服务端日志

### 自动重连失败

客户端会自动重连，使用指数退避策略：

- 第 1 次：1 秒后重连
- 第 2 次：2 秒后重连
- 第 3 次：4 秒后重连
- …
- 最多重连 10 次

如果达到最大重连次数，需要手动刷新页面。

## 示例

### 完整示例：接收任务通知

```javascript
// 注册任务完成处理器
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `任务失败: ${event.error}`
    : `任务完成: ${event.result}`;
  
  // 显示通知
  showNotification(message);
});

// 注册连接状态处理器
window.wsClient.on('connection', (data) => {
  if (data.connected) {
    console.log('WebSocket 已连接');
  } else {
    console.log('WebSocket 已断开');
  }
});
```

### 完整示例：发送命令

```javascript
// 发送重启任务命令
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket 未连接');
    return;
  }
  
  window.wsClient.sendCommand('restart-task', { taskId });
}

// 发送取消任务命令
function cancelTask(taskId) {
  window.wsClient.sendCommand('cancel-task', { taskId });
}
```

## 性能优化

1. **消息批处理** — 如果需要发送大量消息，考虑批处理
2. **心跳间隔** — 根据网络环境调整心跳间隔
3. **连接池** — 对于多客户端场景，服务端会自动管理连接

## 安全注意事项

1. **本地连接** — 当前仅支持本地连接（localhost）
2. **无认证** — 当前版本无认证机制，仅用于本地开发
3. **消息验证** — 服务端会验证消息格式

## 未来计划

- [ ] 支持 TLS/WSS
- [ ] 添加认证机制
- [ ] 支持远程连接
- [ ] 消息压缩
- [ ] 离线消息队列持久化

事件总线 API 见 [event-bridge-api.md](./event-bridge-api.md)。
