# EventBridge API

## Overview

EventBridge is a lightweight in-process event bus connecting the execution engine and channel plugins for bidirectional messaging.

## Import

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### `notifyTaskComplete(taskId: string, result?: any): void`

Emit a task completion notification.

**Parameters**

- `taskId` — task identifier  
- `result` — optional payload, may include:  
  - `taskName`  
  - `result` — successful output  
  - `error` — failure details  
  - `duration` — milliseconds  
  - `status` — `'success' | 'failed'`

**Example**

```typescript
// Success
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'Data processing job',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

// Failure
eventBridge.notifyTaskComplete('task-456', {
  taskName: 'Data processing job',
  error: 'Connection timed out',
  duration: 3000,
  status: 'failed',
});
```

### `onTaskComplete(callback: (event: TaskCompleteEvent) => void): void`

Subscribe to task completion events.

**Parameters**

- `callback` — invoked with a `TaskCompleteEvent`

**`TaskCompleteEvent`**

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

**Example**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`Task ${event.taskId} finished`);
  if (event.error) {
    console.error('Failed:', event.error);
  } else {
    console.log('Result:', event.result);
  }
});
```

### `sendCommand(command: string, args?: any, channelId?: string): void`

Send a command from a channel to the execution engine.

**Parameters**

- `command` — command name  
- `args` — optional arguments  
- `channelId` — optional sender id  

**Example**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### `onCommand(callback: (event: CommandEvent) => void): void`

Subscribe to command events.

**Parameters**

- `callback` — invoked with a `CommandEvent`

**`CommandEvent`**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**Example**

```typescript
eventBridge.onCommand((event) => {
  console.log(`Command received: ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      // handle restart
      break;
    case 'cancel-task':
      // handle cancel
      break;
  }
});
```

### `offTaskComplete(callback): void`

Remove a task completion listener.

### `offCommand(callback): void`

Remove a command listener.

## Usage patterns

### Pattern 1: Cron manager integration

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

### Pattern 2: Channel plugin subscription

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    eventBridge.onTaskComplete((event) => {
      this.sendNotification({
        title: `Task ${event.taskId} finished`,
        content: event.error ? `Failed: ${event.error}` : 'Succeeded',
      });
    });
  }
}
```

## Notes

1. **Global singleton** — all modules share one `eventBridge` instance.  
2. **Asynchronous dispatch** — listeners do not block publishers.  
3. **Error isolation** — a throwing subscriber does not cancel others.  
4. **Memory hygiene** — remove listeners you no longer need to avoid leaks.  
