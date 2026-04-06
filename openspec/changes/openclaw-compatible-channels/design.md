## Context

**当前状态：**
- squid 已有基础的 channel 系统（`src/channels/`）
- 定时任务和后台任务结果只输出到控制台
- 聊天界面是独立的 UI 组件

**核心需求：**
1. OpenClaw 的飞书插件能直接在 squid 上运行
2. 聊天框改造成插件，与引擎双向通信
3. 用最简单的方式实现

**约束：**
- 保持现有功能不变
- 最小化改动
- 不需要完整实现 OpenClaw 的所有功能

## Goals / Non-Goals

**Goals:**
- 创建简单的事件总线，连接引擎和 channel
- 将聊天框改造为 WebUIChannelPlugin
- 提供最小化适配层，让 OpenClaw 飞书插件能运行
- 定时任务/后台任务完成时通知到 channel

**Non-Goals:**
- 不实现复杂的消息路由系统
- 不实现完整的 OpenClaw 接口兼容
- 不实现插件市场和动态加载
- 不实现消息持久化和历史记录

## Decisions

### 决策 1: 使用简单的 EventEmitter 作为事件总线

**选择：** 创建一个基于 EventEmitter 的 `EventBridge` 类

**理由：**
- Node.js 内置，无需额外依赖
- 简单直接，易于理解和维护
- 足够满足当前需求

**实现：**
```typescript
// src/channels/bridge/event-bridge.ts
import { EventEmitter } from 'events';

export class EventBridge extends EventEmitter {
  // 发送任务完成事件
  notifyTaskComplete(taskId: string, result: any) {
    this.emit('task:complete', { taskId, result });
  }
  
  // Channel 订阅任务完成事件
  onTaskComplete(callback: (event) => void) {
    this.on('task:complete', callback);
  }
  
  // Channel 发送命令
  sendCommand(command: string, args: any) {
    this.emit('command', { command, args });
  }
  
  // 引擎订阅命令
  onCommand(callback: (event) => void) {
    this.on('command', callback);
  }
}

// 全局单例
export const eventBridge = new EventBridge();
```

### 决策 2: WebUI Channel 使用 WebSocket

**选择：** 使用 `ws` 库实现 WebSocket 服务器

**理由：**
- 支持服务端主动推送
- 实时性好
- 实现简单

**实现：**
```typescript
// src/channels/plugins/webui/plugin.ts
import { WebSocketServer } from 'ws';
import { eventBridge } from '../../bridge/event-bridge';

export class WebUIChannelPlugin implements ChannelPlugin {
  private wss: WebSocketServer;
  
  constructor() {
    this.wss = new WebSocketServer({ port: 8080 });
    
    // 订阅任务完成事件
    eventBridge.onTaskComplete((event) => {
      this.broadcast({
        type: 'task:complete',
        data: event
      });
    });
    
    // 监听客户端消息
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'command') {
          eventBridge.sendCommand(msg.command, msg.args);
        }
      });
    });
  }
  
  broadcast(message: any) {
    this.wss.clients.forEach(client => {
      client.send(JSON.stringify(message));
    });
  }
}
```

### 决策 3: OpenClaw 插件适配 - 只实现必需接口

**选择：** 创建一个简单的适配器，只实现飞书插件需要的接口

**理由：**
- 不需要完整实现 OpenClaw 的所有接口
- 按需实现，减少工作量
- 先让飞书插件跑起来，再逐步完善

**实现：**
```typescript
// src/channels/openclaw-adapter/adapter.ts
export class OpenClawPluginAdapter implements ChannelPlugin {
  constructor(private openclawPlugin: any) {}
  
  // 只实现飞书插件需要的核心方法
  async sendMessage(content: string) {
    // 调用 OpenClaw 插件的发送方法
    return this.openclawPlugin.send({ content });
  }
  
  onMessage(callback: (msg) => void) {
    // 监听 OpenClaw 插件的消息
    this.openclawPlugin.on('message', callback);
  }
}
```

### 决策 4: 调度器和任务执行集成事件总线

**选择：** 在任务完成时调用 `eventBridge.notifyTaskComplete()`

**理由：**
- 最小化改动
- 不破坏现有逻辑
- 易于测试

**实现：**
```typescript
// src/scheduler/task-runner.ts
import { eventBridge } from '../channels/bridge/event-bridge';

async function runTask(task: Task) {
  try {
    const result = await executeTask(task);
    
    // 发送任务完成事件
    eventBridge.notifyTaskComplete(task.id, result);
    
    return result;
  } catch (error) {
    eventBridge.notifyTaskComplete(task.id, { error });
    throw error;
  }
}
```

## Risks / Trade-offs

### 风险 1: OpenClaw 插件可能需要更多接口

**影响：** 飞书插件可能无法完全工作

**缓解措施：**
- 先测试飞书插件，看需要哪些接口
- 按需添加接口实现
- 记录缺失的接口，逐步完善

### 风险 2: WebSocket 连接不稳定

**影响：** 聊天框可能收不到通知

**缓解措施：**
- 实现自动重连
- 添加心跳检测
- 如果问题严重，可以降级到轮询

### Trade-off: 简单性 vs 完整性

**选择：** 优先简单性，先实现核心功能

**理由：** 快速验证方案可行性，避免过度设计

## Migration Plan

**阶段 1: 事件总线（1-2小时）**
1. 创建 EventBridge 类
2. 添加基本的事件发布/订阅方法
3. 单元测试

**阶段 2: WebUI Channel（2-3小时）**
1. 实现 WebUIChannelPlugin
2. 实现 WebSocket 服务器
3. 前端 WebSocket 客户端
4. 集成到聊天界面

**阶段 3: 集成调度器和任务执行（1-2小时）**
1. 在调度器中添加事件发送
2. 在任务执行中添加事件发送
3. 测试端到端流程

**阶段 4: OpenClaw 适配器（2-3小时）**
1. 研究飞书插件需要的接口
2. 实现最小化适配器
3. 测试飞书插件能否运行

**总计：** 6-10 小时

**回滚策略：**
- 事件总线是新增功能，不影响现有系统
- 如果出现问题，可以直接移除相关代码

## Open Questions

1. **飞书插件具体需要哪些接口？**
   - 需要先查看飞书插件的代码
   - 列出必需的接口清单

2. **WebSocket 端口如何配置？**
   - 使用配置文件
   - 或者自动选择可用端口

3. **多个 channel 同时通知时如何处理？**
   - 并发发送
   - 或者按优先级顺序发送
