# EventBridge API リファレンス

## 概要

EventBridge は、実行エンジンと channel プラグインの双方向通信をつなぐシンプルなイベントバスです。

## インポート

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';
```

## API

### notifyTaskComplete(taskId: string, result?: any): void

タスク完了を通知します。

**パラメータ：**

- `taskId` — タスク ID  
- `result` — 任意の結果オブジェクト。例：  
  - `taskName` — タスク名  
  - `result` — 実行結果  
  - `error` — 失敗時のエラー情報  
  - `duration` — 所要時間（ミリ秒）  
  - `status` — 状態（`'success' | 'failed'`）

**例：**

```typescript
// 成功
eventBridge.notifyTaskComplete('task-123', {
  taskName: 'データ処理タスク',
  result: { processed: 100 },
  duration: 5000,
  status: 'success',
});

// 失敗
eventBridge.notifyTaskComplete('task-456', {
  taskName: 'データ処理タスク',
  error: '接続タイムアウト',
  duration: 3000,
  status: 'failed',
});
```

### onTaskComplete(callback: (event: TaskCompleteEvent) => void): void

タスク完了イベントを購読します。

**パラメータ：**

- `callback` — `TaskCompleteEvent` を受け取るコールバック

**TaskCompleteEvent 型：**

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

**例：**

```typescript
eventBridge.onTaskComplete((event) => {
  console.log(`タスク ${event.taskId} が完了`);
  if (event.error) {
    console.error('失敗:', event.error);
  } else {
    console.log('結果:', event.result);
  }
});
```

### sendCommand(command: string, args?: any, channelId?: string): void

channel から実行エンジンへコマンドを送ります。

**パラメータ：**

- `command` — コマンド名  
- `args` — コマンド引数（任意）  
- `channelId` — 送信元 channel ID（任意）

**例：**

```typescript
eventBridge.sendCommand('restart-task', { taskId: 'task-123' }, 'webui');
```

### onCommand(callback: (event: CommandEvent) => void): void

コマンドイベントを購読します。

**パラメータ：**

- `callback` — `CommandEvent` を受け取るコールバック

**CommandEvent 型：**

```typescript
interface CommandEvent {
  command: string;
  args?: any;
  channelId?: string;
  timestamp: number;
}
```

**例：**

```typescript
eventBridge.onCommand((event) => {
  console.log(`コマンド受信: ${event.command}`);
  switch (event.command) {
    case 'restart-task':
      // タスク再起動
      break;
    case 'cancel-task':
      // タスク取消
      break;
  }
});
```

### offTaskComplete(callback): void

タスク完了リスナーを削除します。

### offCommand(callback): void

コマンドリスナーを削除します。

## 利用シナリオ

### シナリオ 1: Cron マネージャとの統合

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

### シナリオ 2: Channel プラグインがイベントを購読

```typescript
import { eventBridge } from '../channels/bridge/event-bridge';

class MyChannelPlugin implements ChannelPlugin {
  constructor() {
    eventBridge.onTaskComplete((event) => {
      this.sendNotification({
        title: `タスク ${event.taskId} が完了`,
        content: event.error ? `失敗: ${event.error}` : '成功',
      });
    });
  }
}
```

## 注意事項

1. **グローバルシングルトン** — `eventBridge` はプロセス全体で 1 インスタンスです。  
2. **非同期処理** — イベント処理は送信側をブロックしません。  
3. **エラー処理** — ある購読者のエラーは他の購読者に影響しません。  
4. **メモリ管理** — 不要になったらリスナーを外し、リークを避けてください。
