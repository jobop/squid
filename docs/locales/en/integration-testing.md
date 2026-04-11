# Integration testing guide

How to exercise the `openclaw-compatible-channels` feature set manually.

## Prerequisites

1. Dependencies installed: `npm install`  
2. API keys configured in Settings  
3. App running: `npm run dev`  

## Scenarios

### Scenario 1: Scheduled job completion notifies the chat surface

**Goal**: ensure cron completions surface in the chat UI.

**Steps**

1. Start the app  
   ```bash
   npm run dev
   ```  

2. Open browser devtools → Console.  

3. Confirm the WebSocket client connected (look for a WebSocket success log appropriate to your build).  

4. Create a scheduled job (cron tool or API)  
   ```typescript
   const result = cronManager.createTask('*/1 * * * *', 'Print the current time'); // every minute
   console.log(result);
   ```  

5. Wait for execution (within one minute).  

6. Verify the chat UI shows a completion notification with task id, status, and duration.

**Expected**

- WebSocket connected  
- Job ran to completion  
- Notification rendered with full metadata  

---

### Scenario 2: Background (non-cron) task completion notifies chat

**Goal**: non-scheduled tasks also emit UI notifications.

**Steps**

1. Send a prompt such as “Generate a Hello World program for me.”  
2. Wait for completion.  
3. Confirm a completion notification appears.

**Expected**

- Task completes  
- Notification shows results  

---

### Scenario 3: Chat sends commands to the engine

**Goal**: commands issued from the browser reach the backend.

**Steps**

1. Open devtools Console.  
2. Run  
   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```  
3. Inspect server logs for the command.

**Expected**

- Command accepted client-side  
- Server logs show ingestion  
- EventBridge emits a command event  

---

### Scenario 4: WebSocket auto-reconnect

**Goal**: transient disconnects recover automatically.

**Steps**

1. Start the app and confirm the socket is up.  
2. Stop the backend (simulate outage).  
3. Watch the console for disconnect and backoff logs.  
4. Restart the backend.  
5. Confirm the client reconnects.

**Expected**

- Disconnect detected  
- Backoff reconnect attempts  
- Successful reconnect after the service returns  

---

### Scenario 5: Multiple browser clients

**Goal**: fan-out notifications to every connected tab.

**Steps**

1. Open two tabs to the app.  
2. Trigger a task completion from either tab.  
3. Both tabs should show the notification; server logs should list two clients.

---

### Scenario 6: OpenClaw Feishu plugin (requires credentials)

**Goal**: optional validation that an OpenClaw-style Feishu plugin can send/receive.

**Prerequisites**

- `@openclaw/feishu-plugin` installed (if you are testing that path)  
- Valid Feishu `appId` / `appSecret`

**Steps**

1. Load the adapter sketch:  
   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```  

2. Configure credentials via the adapter API.  
3. Trigger a task completion and confirm Feishu receives a notification.  
4. Send a message from Feishu and confirm the app receives it.

---

## Unit tests

```bash
npm test
```

Coverage includes EventBridge publish/subscribe, WebUIChannelPlugin basics, configuration, and status checks.

---

## Troubleshooting

### WebSocket connection failures

**Symptoms**: console shows connection errors.

**Checks**

1. Backend running  
2. Port 8080 free (or whichever port you configured)  
3. Local firewall rules  

**Mitigations**

```bash
lsof -i :8080
# adjust port in config/channels.json if needed
```

### Missing task notifications

**Symptoms**: tasks finish but chat stays silent.

**Checks**

1. WebSocket connected  
2. `notifyTaskComplete` invoked on the server  
3. Browser console errors  

**Debug**

```javascript
console.log(window.wsClient.isConnected()); // expect true
```

### Feishu plugin initialization errors

**Symptoms**: stack traces during `initialize`.

**Checks**

1. Package installed  
2. Configuration complete  
3. Network reachability to Feishu APIs  

---

## Performance checks

### Message throughput

```javascript
for (let i = 0; i < 1000; i++) {
  eventBridge.notifyTaskComplete(`task-${i}`, { result: i });
}
```

Watch delivery latency, backlog, and memory.

### Long-run stability

Keep the app up for an extended window; verify heartbeats, reconnects, and absence of memory leaks.

---

## Pre-release checklist

- [ ] EventBridge unit tests green  
- [ ] WebUIChannelPlugin unit tests green  
- [ ] Cron → chat notification  
- [ ] Background task → chat notification  
- [ ] Chat command → engine  
- [ ] WebSocket reconnect  
- [ ] Multi-client fan-out  
- [ ] Feishu integration (if in scope)  
- [ ] Throughput smoke test  
- [ ] Long-run soak (if feasible)  

---

## Future automation

Example Vitest/Playwright sketch:

```typescript
describe('End-to-end channel smoke', () => {
  it('should notify chat after a cron task completes', async () => {
    // 1. boot app harness
    // 2. create cron task
    // 3. await execution
    // 4. assert websocket payload
    // 5. assert UI notification
  });
});
```
