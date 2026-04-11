# Канал WebUI

## Обзор

**WebUI Channel** — встроенный плагин канала: чат приложения рассматривается как обычный channel с **двусторонней** связью через WebSocket с движком выполнения.

В боковой панели **«Каналы»** отображается список каналов и статус; карточка WebUI **только для чтения**, отдельной веб‑формы настройки нет.

## Возможности

- уведомления о завершении задач в реальном времени;  
- отправка команд из чата;  
- автоматическое переподключение WebSocket;  
- heartbeat;  
- несколько клиентов (вкладок).  

## Архитектура

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│  Frontend   │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (браузер)   │                         │   (backend)       │
└─────────────┘                         └─────────┬────────┘
                                                  │
                                                  │ EventBridge
                                                  ▼
                                        ┌──────────────────┐
                                        │   Движок         │
                                        │(CronManager/Tasks)│
                                        └──────────────────┘
```

## Конфигурация

### Сервер

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

- `enabled` — включить канал  
- `port` — порт WebSocket (по умолчанию 8080)  
- `heartbeatInterval` — интервал ping в мс (по умолчанию 30000)  

### Клиент

По умолчанию `ws://localhost:8080`. Смена URL — в `public/websocket-client.js`:

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## Использование

### Запуск

WebUI инициализируется при старте приложения:

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### Уведомления о задачах

В `index.html` уже регистрируется обработчик:

```javascript
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### Команды

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## Форматы сообщений

### Сервер → клиент

**Завершение задачи**

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "Data processing",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

**Общее уведомление**

```json
{
  "type": "notification",
  "data": {
    "title": "System",
    "content": "OK",
    "type": "success"
  }
}
```

**Ping**

```json
{
  "type": "ping"
}
```

### Клиент → сервер

**Команда**

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

**Pong**

```json
{
  "type": "pong"
}
```

## API клиента WebSocketClient

### connect()

```javascript
window.wsClient.connect();
```

### disconnect()

```javascript
window.wsClient.disconnect();
```

### send(type, data)

```javascript
window.wsClient.send('command', { command: 'test', args: {} });
```

### sendCommand(command, args)

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

### on(type, handler)

```javascript
window.wsClient.on('task:complete', (event) => {
  console.log('Done:', event);
});
```

### off(type, handler)

```javascript
window.wsClient.off('task:complete', handler);
```

### isConnected()

```javascript
if (window.wsClient.isConnected()) {
  console.log('connected');
}
```

## Диагностика

### Не коннектится

Проверьте, что сервер WebSocket запущен, порт свободен, в Console нет ошибок TLS/сети.

### События не приходят

Состояние сокета, вызовы EventBridge на сервере, логи бэкенда.

### Реконнект исчерпан

Клиент использует экспоненциальную задержку: 1 с, 2 с, 4 с, … до лимита попыток (например 10). Дальше — обновление страницы вручную.

## Примеры

### Уведомление

```javascript
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `Failed: ${event.error}`
    : `Done: ${event.result}`;
  showNotification(message);
});

window.wsClient.on('connection', (data) => {
  console.log(data.connected ? 'WebSocket up' : 'WebSocket down');
});
```

### Команды

```javascript
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket offline');
    return;
  }
  window.wsClient.sendCommand('restart-task', { taskId });
}
```

## Производительность

1. Пакетирование сообщений при массовой отправке  
2. Настройка heartbeat под сеть  
3. На сервере — учёт пула подключений  

## Безопасность

1. Расчёт на **localhost**  
2. **Без аутентификации** в текущей версии — только локальная разработка  
3. Сервер валидирует формат сообщений  

## Планы

- [ ] TLS/WSS  
- [ ] Аутентификация  
- [ ] Удалённый доступ под контролем  
- [ ] Сжатие сообщений  
- [ ] Персистентная очередь офлайн‑сообщений  
