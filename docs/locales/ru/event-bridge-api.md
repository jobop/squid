# Документация API EventBridge

## Обзор

**EventBridge** — лёгкая шина событий для двусторонней связи между движком выполнения и плагинами каналов.

## Импорт

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### notifyTaskComplete(taskId: string, result?: any): void

Уведомление о завершении задачи.

**Параметры:**

- `taskId` — идентификатор задачи
- `result` — опционально объект с полями:
  - `taskName` — имя задачи
  - `result` — результат
  - `error` — текст/объект ошибки при сбое
  - `duration` — длительность в мс
  - `status` — `'success' | 'failed'`

**Примеры:**

```typescript
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'Data processing',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

eventBridge.notifyTaskComplete('task-456', {
  taskName: 'Data processing',
  error: 'Connection timeout',
  duration: 3000,
  status: 'failed',
});
```

### onTaskComplete(callback: (event: TaskCompleteEvent) => void): void

Подписка на завершение задачи.

**TaskCompleteEvent:**

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

**Пример:**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`Task ${event.taskId} completed`);
  if (event.error) {
    console.error('Failed:', event.error);
  } else {
    console.log('Result:', event.result);
  }
});
```

### sendCommand(command: string, args?: any, channelId?: string): void

Команда от канала к движку.

**Параметры:**

- `command` — имя команды
- `args` — аргументы (опционально)
- `channelId` — id канала‑отправителя (опционально)

**Пример:**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### onCommand(callback: (event: CommandEvent) => void): void

Подписка на команды.

**CommandEvent:**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**Пример:**

```typescript
eventBridge.onCommand((event) => {
  console.log(`Command: ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      break;
    case 'cancel-task':
      break;
  }
});
```

### offTaskComplete(callback): void

Снять подписку на завершение задач.

### offCommand(callback): void

Снять подписку на команды.

## Сценарии

### 1. Интеграция с Cron

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

### 2. Плагин канала подписывается на события

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    eventBridge.onTaskComplete((event) => {
      this.sendNotification({
        title: `Task ${event.taskId} completed`,
        content: event.error ? `Failed: ${event.error}` : 'Success',
      });
    });
  }
}
```

## Замечания

1. **Глобальный синглтон** — один экземпляр на процесс  
2. **Асинхронность** — обработчики не блокируют отправителя  
3. **Изоляция ошибок** — сбой одного подписчика не отменяет остальных  
4. **Память** — снимайте подписки, когда они больше не нужны  
