# Documentation WebUI Channel

## Vue d’ensemble

WebUI Channel est un plugin de canal intégré qui traite la zone de chat comme un canal standard, avec communication bidirectionnelle WebSocket vers le moteur d’exécution.

Dans la barre latérale **Canaux**, la liste inclut WebUI avec l’état de santé ; la fiche WebUI est informative (pas de formulaire Web de configuration).

## Fonctionnalités

- Notifications temps réel de fin de tâche  
- Envoi de commandes depuis le chat  
- Reconnexion WebSocket automatique  
- Heartbeat pour maintenir la session  
- Plusieurs clients simultanés  

## Architecture

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│ Page front  │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (navigateur)│                           │   (backend)      │
└─────────────┘                           └────────┬─────────┘
                                                    │
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │  Moteur          │
                                          │(CronManager/Tasks)│
                                          └──────────────────┘
```

## Configuration

### Côté serveur

Dans `config/channels.json` :

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

**Champs :**

- `enabled` — activer WebUI Channel  
- `port` — port du serveur WebSocket (défaut 8080)  
- `heartbeatInterval` — intervalle de heartbeat en millisecondes (défaut 30000)  

### Côté client

Le client se connecte par défaut à `ws://localhost:8080`. Pour changer l’URL, modifier `public/websocket-client.js` :

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## Utilisation

### 1. Démarrage

WebUI Channel s’initialise au lancement de l’application :

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### 2. Notifications de tâche

Enregistrement automatique dans la page (exemple) :

```javascript
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### 3. Envoi de commandes

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## Formats de messages

### Serveur → client

#### Fin de tâche

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "Traitement des données",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

#### Notification générique

```json
{
  "type": "notification",
  "data": {
    "title": "Notification système",
    "content": "Opération réussie",
    "type": "success"
  }
}
```

#### Heartbeat

```json
{
  "type": "ping"
}
```

### Client → serveur

#### Commande

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

#### Réponse au ping

```json
{
  "type": "pong"
}
```

## Référence API — WebSocketClient (frontend)

### connect()

Établit la connexion WebSocket.

### disconnect()

Ferme la connexion.

### send(type, data)

Envoie un message typé.

### sendCommand(command, args)

Raccourci pour une commande.

### on(type, handler) / off(type, handler)

Abonnement / désabonnement aux événements.

### isConnected()

Retourne l’état de connexion.

## Dépannage

### Connexion impossible

Vérifier que le serveur WebSocket tourne, que le port est libre, consulter la console navigateur.

### Messages absents

État WebSocket, émission EventBridge côté serveur, journaux.

### Reconnexion

Backoff exponentiel : 1 s, 2 s, 4 s, … jusqu’à 10 tentatives ; au-delà, recharger la page.

## Exemples

### Réception

```javascript
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `Échec de la tâche : ${event.error}`
    : `Tâche terminée : ${event.result}`;
  showNotification(message);
});

window.wsClient.on('connection', (data) => {
  if (data.connected) {
    console.log('WebSocket connecté');
  } else {
    console.log('WebSocket déconnecté');
  }
});
```

### Envoi

```javascript
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket non connecté');
    return;
  }
  window.wsClient.sendCommand('restart-task', { taskId });
}

function cancelTask(taskId) {
  window.wsClient.sendCommand('cancel-task', { taskId });
}
```

## Performance

1. Regrouper les envois si très nombreux messages  
2. Ajuster l’intervalle de heartbeat selon le réseau  
3. Le serveur gère un ensemble de connexions clients  

## Sécurité

1. Connexion locale (`localhost`) dans la configuration actuelle  
2. Pas d’authentification intégrée — usage développement / local  
3. Validation du format des messages côté serveur  

## Évolutions envisagées

- [ ] TLS / WSS  
- [ ] Authentification  
- [ ] Connexion distante contrôlée  
- [ ] Compression des messages  
- [ ] Persistance de file hors ligne  
