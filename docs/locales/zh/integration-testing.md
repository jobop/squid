# 集成测试指南

本文档说明如何测试 openclaw-compatible-channels 功能。

## 前置条件

1. 已安装依赖：`npm install`
2. 已配置 API Key（在设置页面）
3. 应用已启动：`npm run dev`

## 测试场景

### 场景 1：定时任务完成通知到聊天框

**目标：** 验证定时任务完成后，通知能显示在聊天框中

**步骤：**

1. 启动应用

   ```bash
   npm run dev
   ```

2. 打开浏览器开发者工具，查看 Console

3. 验证 WebSocket 连接

   ```
   应该看到：[WebSocket] 连接成功
   ```

4. 创建一个定时任务（使用 cron 工具）

   ```typescript
   // 在代码中或通过 API 创建
   const result = cronManager.createTask('*/1 * * * *', '输出当前时间'); // 每分钟执行
   console.log(result);
   ```

5. 等待任务执行（1 分钟内）

6. 验证聊天框显示通知

   ```
   应该看到：
   - 任务完成通知消息
   - 包含任务 ID、状态、耗时等信息
   ```

**预期结果：**

- WebSocket 连接成功
- 任务执行完成
- 聊天框显示通知
- 通知包含完整信息

---

### 场景 2：后台任务完成通知到聊天框

**目标：** 验证后台任务（非定时）完成后，通知能显示在聊天框中

**步骤：**

1. 在聊天框输入一个任务

   ```
   帮我生成一个 Hello World 程序
   ```

2. 点击发送，等待任务执行

3. 验证聊天框显示任务完成通知

**预期结果：**

- 任务执行完成
- 聊天框显示通知
- 通知包含任务结果

---

### 场景 3：聊天框发送命令到引擎

**目标：** 验证从聊天框发送的命令能被引擎接收

**步骤：**

1. 打开浏览器开发者工具 Console

2. 发送测试命令

   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```

3. 查看服务端日志，验证命令被接收

**预期结果：**

- 命令发送成功
- 服务端接收到命令
- EventBridge 触发 command 事件

---

### 场景 4：WebSocket 自动重连

**目标：** 验证 WebSocket 断开后能自动重连

**步骤：**

1. 启动应用，验证 WebSocket 连接成功

2. 停止后端服务（模拟断开）

   ```bash
   # 停止应用
   ```

3. 观察浏览器 Console

   ```
   应该看到：[WebSocket] 连接关闭
   应该看到：[WebSocket] X秒后尝试第 N 次重连
   ```

4. 重新启动后端服务

5. 验证自动重连成功

   ```
   应该看到：[WebSocket] 连接成功
   ```

**预期结果：**

- 检测到连接断开
- 自动尝试重连
- 重连成功

---

### 场景 5：多客户端连接

**目标：** 验证多个浏览器标签页可以同时连接

**步骤：**

1. 打开第一个浏览器标签页，访问应用

2. 打开第二个浏览器标签页，访问应用

3. 在任一标签页触发任务完成

4. 验证两个标签页都收到通知

**预期结果：**

- 两个客户端都连接成功
- 两个客户端都收到通知
- 服务端日志显示 2 个客户端连接

---

### 场景 6：OpenClaw 飞书插件集成（需要飞书凭证）

**目标：** 验证飞书插件能正常收发消息

**前置条件：**

- 已安装 OpenClaw 飞书插件
- 已配置飞书 appId 和 appSecret

**步骤：**

1. 加载飞书插件

   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```

2. 配置飞书凭证

   ```typescript
   adapter.config.set('appId', 'your-app-id');
   adapter.config.set('appSecret', 'your-app-secret');
   ```

3. 触发一个任务完成

4. 验证飞书收到通知消息

5. 在飞书发送消息

6. 验证应用收到消息

**预期结果：**

- 飞书插件加载成功
- 任务通知发送到飞书
- 飞书消息转发到应用

---

## 单元测试

运行单元测试：

```bash
npm test
```

测试覆盖：

- EventBridge 事件发送和订阅
- WebUIChannelPlugin 基本功能
- 配置管理
- 状态检查

---

## 故障排查

### WebSocket 连接失败

**症状：** 浏览器 Console 显示连接错误

**检查：**

1. 后端服务是否启动
2. 端口 8080 是否被占用
3. 防火墙是否阻止连接

**解决：**

```bash
# 检查端口占用
lsof -i :8080

# 修改端口（如果需要）
# 在 config/channels.json 中修改 port
```

### 任务通知未显示

**症状：** 任务完成但聊天框没有通知

**检查：**

1. WebSocket 是否连接
2. EventBridge 是否正确调用
3. 浏览器 Console 是否有错误

**解决：**

```javascript
// 在浏览器 Console 检查
console.log(window.wsClient.isConnected()); // 应该返回 true

// 手动触发测试
eventBridge.notifyTaskComplete('test', { result: 'test' });
```

### 飞书插件加载失败

**症状：** 插件初始化报错

**检查：**

1. 插件是否正确安装
2. 配置是否完整
3. 网络是否可访问飞书 API

**解决：**

```bash
# 重新安装插件
npm install @openclaw/feishu-plugin

# 检查配置
adapter.config.validate(); // 应该返回 true
```

---

## 性能测试

### 消息吞吐量

测试 WebSocket 能处理的消息数量：

```javascript
// 发送 1000 条消息
for (let i = 0; i < 1000; i++) {
  eventBridge.notifyTaskComplete(`task-${i}`, { result: i });
}

// 观察：
// - 消息是否全部送达
// - 是否有延迟
// - 内存使用情况
```

### 连接稳定性

长时间运行测试：

```bash
# 启动应用，保持运行 24 小时
# 观察：
# - WebSocket 是否保持连接
# - 心跳是否正常
# - 是否有内存泄漏
```

---

## 测试清单

在发布前，确保以下测试通过：

- [ ] EventBridge 单元测试通过
- [ ] WebUIChannelPlugin 单元测试通过
- [ ] 定时任务通知到聊天框
- [ ] 后台任务通知到聊天框
- [ ] 聊天框命令发送到引擎
- [ ] WebSocket 自动重连
- [ ] 多客户端连接
- [ ] 飞书插件集成（如果使用）
- [ ] 性能测试通过
- [ ] 长时间稳定性测试通过

---

## 自动化测试

未来可以添加自动化测试：

```typescript
// 示例：端到端测试
describe('端到端测试', () => {
  it('定时任务完成后应该通知到聊天框', async () => {
    // 1. 启动应用
    // 2. 创建定时任务
    // 3. 等待任务执行
    // 4. 验证 WebSocket 收到通知
    // 5. 验证聊天框显示通知
  });
});
```

更多 API 说明见 [event-bridge-api.md](./event-bridge-api.md) 与 [webui-channel.md](./webui-channel.md)。
