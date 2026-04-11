# WebUI channel guide

## Overview

The WebUI channel is a built-in plugin that treats the main chat surface as a first-class channel, using WebSocket for bidirectional communication with the execution engine.

Open the **Channels** sidebar to inspect WebUI alongside other channels; the WebUI detail card is read-only reference—there is no separate web configuration UI.

## Features

- Live task completion notifications  
- Command channel from the chat UI  
- Automatic WebSocket reconnect  
- Heartbeats  
- Multiple simultaneous browser clients  

## Architecture

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│ Web client  │ ◄──────────────────────► │ WebUIChannelPlugin│
│ (browser)   │                           │   (backend)       │
└─────────────┘                           └─────────┬────────┘
                                                    │
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │ Execution engine │
                                          │ (Cron / tasks)   │
                                          └──────────────────┘
```

## Configuration

### Server-side

`config/channels.json`:

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

Fields:

- `enabled` — master toggle  
- `port` — WebSocket listen port (default `8080`)  
- `heartbeatInterval` — milliseconds between pings (default `30000`)  

### Client-side

The bundled client targets `ws://localhost:8080` by default. To change the URL, edit `public/websocket-client.js`:

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## Usage

### 1. Start the app

WebUI initializes during bootstrap:

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### 2. Receive task notifications

The template registers a handler similar to:

```javascript
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### 3. Send commands

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## Wire protocol

### Server → client

#### Task completion

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "Sample data job",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

#### Generic notification

```json
{
  "type": "notification",
  "data": {
    "title": "System notification",
    "content": "Operation succeeded",
    "type": "success"
  }
}
```

#### Heartbeat ping

```json
{
  "type": "ping"
}
```

### Client → server

#### Command envelope

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

#### Heartbeat response

```json
{
  "type": "pong"
}
```

## Front-end API (`WebSocketClient`)

### `connect()`

```javascript
window.wsClient.connect();
```

### `disconnect()`

```javascript
window.wsClient.disconnect();
```

### `send(type, data)`

```javascript
window.wsClient.send('command', { command: 'test', args: {} });
```

### `sendCommand(command, args)`

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

### `on(type, handler)`

```javascript
window.wsClient.on('task:complete', (event) => {
  console.log('Task finished:', event);
});
```

### `off(type, handler)`

```javascript
window.wsClient.off('task:complete', handler);
```

### `isConnected()`

```javascript
if (window.wsClient.isConnected()) {
  console.log('Socket connected');
}
```

## Troubleshooting

### Cannot connect

1. Confirm the WebSocket server started  
2. Ensure the port is free  
3. Read browser console errors  

### Missing messages

1. Verify the socket state  
2. Confirm EventBridge publishers fired  
3. Inspect backend logs  

### Reconnect stops

The client uses exponential backoff (1s, 2s, 4s, …) up to ten attempts, then requires a manual refresh.

## Examples

### Notify on completion

```javascript
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `Task failed: ${event.error}`
    : `Task finished: ${event.result}`;
  
  showNotification(message);
});

window.wsClient.on('connection', (data) => {
  if (data.connected) {
    console.log('WebSocket connected');
  } else {
    console.log('WebSocket disconnected');
  }
});
```

### Send control commands

```javascript
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket is not connected');
    return;
  }
  
  window.wsClient.sendCommand('restart-task', { taskId });
}

function cancelTask(taskId) {
  window.wsClient.sendCommand('cancel-task', { taskId });
}
```

## Performance notes

1. Batch high-volume notifications if needed.  
2. Tune heartbeat intervals for flaky networks.  
3. The server manages a connection pool for multiple tabs automatically.  

## Security notes

1. **Localhost-first** — default build assumes local clients.  
2. **No auth** — not safe on shared networks without additional controls.  
3. **Validation** — malformed frames should be rejected server-side.  

## Roadmap

- [ ] TLS / WSS  
- [ ] Authentication  
- [ ] Controlled remote access  
- [ ] Payload compression  
- [ ] Durable offline queue  
