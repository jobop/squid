# Documentazione API EventBridge

## Panoramica

EventBridge è un bus eventi leggero che collega il motore di esecuzione e i plugin di canale in comunicazione bidirezionale.

## Import

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### notifyTaskComplete(taskId: string, result?: any): void

Notifica il completamento di un’attività.

**Parametri:**
- `taskId` — identificativo attività
- `result` — oggetto risultato opzionale, può includere:
  - `taskName` — nome attività
  - `result` — risultato dell’esecuzione
  - `error` — messaggio errore in caso di fallimento
  - `duration` — durata in millisecondi
  - `status` — `'success' | 'failed'`

**Esempi:**

```typescript
// successo
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'Elaborazione dati',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

// fallimento
eventBridge.notifyTaskComplete('task-456', {
  taskName: 'Elaborazione dati',
  error: 'Timeout connessione',
  duration: 3000,
  status: 'failed',
});
```

### onTaskComplete(callback: (event: TaskCompleteEvent) => void): void

Sottoscrive gli eventi di completamento attività.

**Parametri:**
- `callback` — funzione che riceve `TaskCompleteEvent`

**Tipo TaskCompleteEvent:**

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

**Esempio:**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`Task ${event.taskId} completed`);
  if (event.error) {
    console.error('Failure:', event.error);
  } else {
    console.log('Result:', event.result);
  }
});
```

### sendCommand(command: string, args?: any, channelId?: string): void

Invia un comando dal canale al motore di esecuzione.

**Parametri:**
- `command` — nome comando
- `args` — argomenti opzionali
- `channelId` — ID canale mittente (opzionale)

**Esempio:**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### onCommand(callback: (event: CommandEvent) => void): void

Sottoscrive gli eventi comando.

**Parametri:**
- `callback` — riceve `CommandEvent`

**Tipo CommandEvent:**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**Esempio:**

```typescript
eventBridge.onCommand((event) => {
  console.log(`Received command: ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      // restart
      break;
    case 'cancel-task':
      // cancel
      break;
  }
});
```

### offTaskComplete(callback): void

Rimuove il listener per il completamento attività.

### offCommand(callback): void

Rimuove il listener per i comandi.

## Scenari d’uso

### Scenario 1: integrazione CronManager

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

### Scenario 2: plugin canale che sottoscrive eventi

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

## Note

1. **Singleton globale** — tutti i moduli condividono la stessa istanza `eventBridge`.
2. **Elaborazione asincrona** — l’invio non blocca il chiamante in modo sincrono sul modello di eventi.
3. **Gestione errori** — un errore in un sottoscrittore non impedisce agli altri di ricevere l’evento.
4. **Memoria** — rimuovere i listener quando non servono per evitare leak.
