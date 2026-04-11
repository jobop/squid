# Documentation de l’API EventBridge

## Vue d’ensemble

EventBridge est un bus d’événements léger reliant le moteur d’exécution et les plugins de canal en communication bidirectionnelle.

## Import

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### notifyTaskComplete(taskId: string, result?: any): void

Signale la fin d’une tâche.

**Paramètres :**

- `taskId` : identifiant de la tâche
- `result` (optionnel) : peut contenir  
  - `taskName` — nom de la tâche  
  - `result` — résultat  
  - `error` — message d’erreur en cas d’échec  
  - `duration` — durée en millisecondes  
  - `status` — `'success' | 'failed'`

**Exemples :**

```typescript
// Succès
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'Traitement des données',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

// Échec
eventBridge.notifyTaskComplete('task-456', {
  taskName: 'Traitement des données',
  error: 'Délai d’attente de connexion',
  duration: 3000,
  status: 'failed',
});
```

### onTaskComplete(callback: (event: TaskCompleteEvent) => void): void

S’abonne aux fins de tâche.

**Paramètres :**

- `callback` : reçoit un `TaskCompleteEvent`

**Type TaskCompleteEvent :**

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

**Exemple :**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`Tâche ${event.taskId} terminée`);
  if (event.error) {
    console.error('Échec :', event.error);
  } else {
    console.log('Résultat :', event.result);
  }
});
```

### sendCommand(command: string, args?: any, channelId?: string): void

Envoie une commande depuis un canal vers le moteur.

**Paramètres :**

- `command` : nom de la commande
- `args` : arguments (optionnel)
- `channelId` : identifiant du canal émetteur (optionnel)

**Exemple :**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### onCommand(callback: (event: CommandEvent) => void): void

S’abonne aux commandes.

**Type CommandEvent :**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**Exemple :**

```typescript
eventBridge.onCommand((event) => {
  console.log(`Commande reçue : ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      // redémarrer la tâche
      break;
    case 'cancel-task':
      // annuler la tâche
      break;
  }
});
```

### offTaskComplete(callback): void

Retire un écouteur de fins de tâche.

### offCommand(callback): void

Retire un écouteur de commandes.

## Cas d’usage

### Cas 1 : intégration au gestionnaire Cron

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

### Cas 2 : plugin de canal abonné aux événements

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    eventBridge.onTaskComplete((event) => {
      this.sendNotification({
        title: `Tâche ${event.taskId} terminée`,
        content: event.error ? `Échec : ${event.error}` : 'Succès',
      });
    });
  }
}
```

## Points d’attention

1. **Instance globale** — un seul `eventBridge` partagé par tous les modules  
2. **Traitement asynchrone** — les écouteurs n’ont pas pour effet de bloquer l’émetteur  
3. **Erreurs** — une exception dans un abonné n’affecte pas les autres  
4. **Mémoire** — désabonnez-vous lorsque les écouteurs ne sont plus nécessaires pour éviter les fuites  
