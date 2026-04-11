# EventBridge API 文档

## 概述

EventBridge 是一个简单的事件总线，用于连接执行引擎和 channel 插件的双向通信。

## 导入

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### notifyTaskComplete(taskId: string, result?: any): void

通知任务完成。

**参数：**
- `taskId` - 任务 ID
- `result` - 任务结果对象，可包含：
  - `taskName` - 任务名称
  - `result` - 执行结果
  - `error` - 错误信息（如果失败）
  - `duration` - 执行耗时（毫秒）
  - `status` - 状态（'success' | 'failed'）

**示例：**

```typescript
// 任务成功
eventBridge.notifyTaskComplete('task-123', {
  taskName: '数据处理任务',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

// 任务失败
eventBridge.notifyTaskComplete('task-456', {
  taskName: '数据处理任务',
  error: '连接超时',
  duration: 3000,
  status: 'failed',
});
```

### onTaskComplete(callback: (event: TaskCompleteEvent) => void): void

订阅任务完成事件。

**参数：**
- `callback` - 回调函数，接收 TaskCompleteEvent 对象

**TaskCompleteEvent 类型：**

```typescript
interface TaskCompleteEvent {
  taskId: string;
  taskName?: string;
  result?: any;
  error?: Error | string;
  duration?: number;
  timestamp: number;
}
```

**示例：**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`任务 ${event.taskId} 完成`);
  if (event.error) {
    console.error('失败:', event.error);
  } else {
    console.log('结果:', event.result);
  }
});
```

### sendCommand(command: string, args?: any, channelId?: string): void

从 channel 发送命令到执行引擎。

**参数：**
- `command` - 命令名称
- `args` - 命令参数（可选）
- `channelId` - 发送命令的 channel ID（可选）

**示例：**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### onCommand(callback: (event: CommandEvent) => void): void

订阅命令事件。

**参数：**
- `callback` - 回调函数，接收 CommandEvent 对象

**CommandEvent 类型：**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**示例：**

```typescript
eventBridge.onCommand((event) => {
  console.log(`收到命令: ${event.command}`);
  // 处理命令
  switch (event.command) {
    case 'restart-task':
      // 重启任务
      break;
    case 'cancel-task':
      // 取消任务
      break;
  }
});
```

### offTaskComplete(callback): void

移除任务完成事件监听器。

### offCommand(callback): void

移除命令事件监听器。

## 使用场景

### 场景 1: Cron 管理器集成

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

async function executeCronTask(task: Task) {
  const startTime = Date.now();
  
  try {
    const result = await runTask(task);
    
    eventBridge.notifyTaskComplete(task.id, {
      taskName: task.name,
      result,
      duration: Date.now() - startTime,
      status: 'success',
    });
  } catch (error) {
    eventBridge.notifyTaskComplete(task.id, {
      taskName: task.name,
      error: error.message,
      duration: Date.now() - startTime,
      status: 'failed',
    });
  }
}
```

### 场景 2: Channel 插件订阅事件

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    // 订阅任务完成事件
    eventBridge.onTaskComplete((event) => {
      // 发送通知到用户
      this.sendNotification({
        title: `任务 ${event.taskId} 完成`,
        content: event.error ? `失败: ${event.error}` : '成功',
      });
    });
  }
}
```

## 注意事项

1. **全局单例** - eventBridge 是全局单例，所有模块共享同一个实例
2. **异步处理** - 事件处理是异步的，不会阻塞发送方
3. **错误处理** - 订阅者的错误不会影响其他订阅者
4. **内存管理** - 记得在不需要时移除监听器，避免内存泄漏
