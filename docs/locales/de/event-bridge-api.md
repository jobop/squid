# EventBridge-API

## Überblick

EventBridge ist ein schlanker Eventbus für die bidirektionale Kommunikation zwischen Ausführungsengine und Channel-Plugins.

## Import

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### `notifyTaskComplete(taskId: string, result?: any): void`

Meldet den Abschluss einer Aufgabe.

**Parameter**:
- `taskId` – Aufgaben-ID
- `result` – optional, u. a.:
  - `taskName`
  - `result` – Ergebnisdaten
  - `error` – Fehlertext bei Misserfolg
  - `duration` – Dauer in ms
  - `status` – `'success' | 'failed'`

**Beispiel**:

```typescript
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'Datenverarbeitung',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

eventBridge.notifyTaskComplete('task-456', {
  taskName: 'Datenverarbeitung',
  error: 'Verbindungs-Timeout',
  duration: 3000,
  status: 'failed',
});
```

### `onTaskComplete(callback: (event: TaskCompleteEvent) => void): void`

Abonniert Aufgabenende-Ereignisse.

**`TaskCompleteEvent`**:

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

**Beispiel**:

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`Aufgabe ${event.taskId} abgeschlossen`);
  if (event.error) {
    console.error('Fehler:', event.error);
  } else {
    console.log('Ergebnis:', event.result);
  }
});
```

### `sendCommand(command: string, args?: any, channelId?: string): void`

Sendet einen Befehl vom Kanal zur Engine.

**Parameter**: `command`, optionale `args`, optionale `channelId`.

**Beispiel**:

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### `onCommand(callback: (event: CommandEvent) => void): void`

Abonniert Befehlsereignisse.

**`CommandEvent`**:

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**Beispiel**:

```typescript
eventBridge.onCommand((event) => {
  console.log(`Befehl: ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      break;
    case 'cancel-task':
      break;
  }
});
```

### `offTaskComplete(callback)`

Entfernt Listener für Aufgabenende.

### `offCommand(callback)`

Entfernt Listener für Befehle.

## Anwendungsfälle

### Cron-Manager

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

### Channel-Plugin abonniert Ereignisse

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    eventBridge.onTaskComplete((event) => {
      this.sendNotification({
        title: `Aufgabe ${event.taskId} abgeschlossen`,
        content: event.error ? `Fehler: ${event.error}` : 'OK',
      });
    });
  }
}
```

## Hinweise

1. **Globale Singleton-Instanz** – alle Module teilen dieselbe `eventBridge`.  
2. **Asynchrone Verarbeitung** – Sender blockieren nicht auf Listener.  
3. **Fehlerisolierung** – Fehler eines Listeners beeinträchtigen andere nicht.  
4. **Speicher** – Listener bei Bedarf abmelden, um Leaks zu vermeiden.
