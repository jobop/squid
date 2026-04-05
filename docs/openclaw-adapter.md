# OpenClaw 插件适配文档

## 概述

本文档说明如何将 OpenClaw 的 channel 插件适配到 jobopx-desktop 上运行。

## 背景

OpenClaw 是一个成熟的多渠道 AI 助手平台，拥有丰富的 channel 插件生态（飞书、钉钉、Telegram、Discord 等）。jobopx-desktop 提供了一个最小化的适配层，让这些插件能够在 jobopx-desktop 上运行。

## 兼容性策略

**核心原则：** 按需实现，不追求完整兼容

- ✅ 实现插件实际使用的接口
- ✅ 提供合理的默认值或降级方案
- ❌ 不实现所有 OpenClaw 接口（工作量太大）

## 架构

```
┌──────────────────┐
│ OpenClaw Plugin  │
│   (飞书/钉钉)    │
└────────┬─────────┘
         │
         │ 调用 OpenClaw 接口
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── 适配层
└────────┬─────────┘
         │
         │ 转换为 jobopx 接口
         ▼
┌──────────────────┐
│  EventBridge     │
└──────────────────┘
```

## 飞书：Adapter 入站 API 与 EventBridge（内置实现）

squid 内置 **飞书开放平台直连**（`FeishuChannelPlugin`），不依赖 OpenClaw `@openclaw/feishu` 运行时。入站消息的**唯一**投递入口为：

| 项 | 说明 |
|----|------|
| 模块 | `src/channels/feishu/inbound-adapter.ts` |
| 函数 | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| 载荷 | `text`（必填）、`chatId`、`messageId`、`senderOpenId`、`accountId`、`raw`（可选原始 JSON） |
| 事件名 | `channel:inbound`（常量 `CHANNEL_INBOUND_EVENT`） |
| Payload 形状 | `ChannelInboundEvent`（见 `src/channels/bridge/event-bridge.ts`），含 `channelId: 'feishu'`、`timestamp` |

**默认**由 `FeishuChannelPlugin` 启动 **WebSocket 长连接**（`feishu-ws-inbound.ts`）收事件，再经同一 Adapter 投递；仅在 `connectionMode: webhook` 时使用 HTTP 路由 `POST /api/feishu/webhook`，在校验签名（及可选解密）后**仅**调用上述函数。

**squid 内置桥接**：`registerFeishuSquidBridge(taskAPI)`（在 `src/bun/index.ts` 启动时注册）订阅 `channel:inbound`，将用户文本交给 `TaskAPI.executeTaskStream`（`conversationId` 为 `feishubot_<chatId>`），并把模型回复用 `sendFeishuTextMessageTo` 发回**同一群/会话**。扩展行为可另订阅 `eventBridge.onChannelInbound`。

若将来采用 **OpenClaw 兼容 shim**，shim MUST 将插件侧入站转发到 `submitFeishuInboundToEventBridge`（或同等封装），以满足 `feishu-openclaw-compatibility` spec。

## 实现步骤

### 步骤 1: 研究插件代码

首先需要了解目标插件实际使用了哪些 OpenClaw 接口。

**示例：分析飞书插件**

```bash
# 查看飞书插件代码
cd openclaw-main/extensions/feishu

# 搜索使用的接口
grep -r "runtime\." src/
```

常见的接口包括：
- `runtime.text.chunkText` - 文本分块
- `runtime.reply.dispatchReply` - 发送回复
- `runtime.routing.resolveAgentRoute` - 路由解析
- `runtime.pairing.*` - 配对管理

### 步骤 2: 创建适配器

创建 `src/channels/openclaw-adapter/adapter.ts`：

```typescript
import { ChannelPlugin } from '../types';
import { eventBridge } from '../bridge/event-bridge';

export class OpenClawChannelAdapter implements ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  constructor(private openclawPlugin: any) {
    this.id = openclawPlugin.id || 'openclaw-plugin';
    this.meta = {
      name: openclawPlugin.name || 'OpenClaw Plugin',
      description: 'OpenClaw 插件适配',
      category: 'third-party',
    };
    
    // 根据插件类型设置能力
    this.capabilities = {
      outbound: { text: true, media: false, rich: true, streaming: false },
      inbound: { text: true, commands: true, interactive: true },
    };
  }

  // 实现必需的接口
  config = {
    get: (key: string) => this.openclawPlugin.config?.[key],
    set: (key: string, value: any) => {
      if (this.openclawPlugin.config) {
        this.openclawPlugin.config[key] = value;
      }
    },
    getAll: () => this.openclawPlugin.config || {},
    validate: () => true,
  };

  outbound = {
    sendText: async (params) => {
      try {
        // 调用 OpenClaw 插件的发送方法
        await this.openclawPlugin.send({
          content: params.content,
          title: params.title,
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    sendNotification: async (message) => {
      return this.outbound.sendText({
        content: message.content,
        title: message.title,
      });
    },
  };

  inbound = {
    onMessage: (callback) => {
      // 监听 OpenClaw 插件的消息
      if (this.openclawPlugin.on) {
        this.openclawPlugin.on('message', (msg: any) => {
          callback(msg);
          
          // 如果是命令，转发到 EventBridge
          if (msg.type === 'command') {
            eventBridge.sendCommand(msg.command, msg.args, this.id);
          }
        });
      }
    },
  };

  status = {
    check: async () => {
      if (this.openclawPlugin.isConnected) {
        const connected = await this.openclawPlugin.isConnected();
        return {
          healthy: connected,
          message: connected ? '已连接' : '未连接',
        };
      }
      return { healthy: true, message: '状态未知' };
    },
  };

  setup = {
    initialize: async () => {
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      }
      
      // 订阅任务完成事件
      eventBridge.onTaskComplete((event) => {
        this.outbound.sendText({
          content: `任务 ${event.taskId} 完成`,
        });
      });
    },
    cleanup: async () => {
      if (this.openclawPlugin.cleanup) {
        await this.openclawPlugin.cleanup();
      }
    },
  };
}
```

### 步骤 3: 提供运行时接口

OpenClaw 插件可能需要访问运行时接口。创建最小化实现：

```typescript
// src/channels/openclaw-adapter/runtime.ts

export const createMinimalRuntime = () => {
  return {
    text: {
      chunkText: (text: string, limit: number) => {
        // 简单的文本分块实现
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += limit) {
          chunks.push(text.slice(i, i + limit));
        }
        return chunks;
      },
      chunkMarkdownText: (text: string, limit: number) => {
        // 简化版：直接调用 chunkText
        return createMinimalRuntime().text.chunkText(text, limit);
      },
    },
    reply: {
      dispatchReply: async (params: any) => {
        // 简化版：直接发送文本
        console.log('Dispatch reply:', params);
      },
    },
    routing: {
      resolveAgentRoute: (params: any) => {
        // 简化版：返回默认路由
        return { sessionKey: 'default', agentId: 'default' };
      },
    },
    // 其他接口按需添加
  };
};
```

### 步骤 4: 加载插件

```typescript
import { OpenClawChannelAdapter } from './openclaw-adapter/adapter';
import { createMinimalRuntime } from './openclaw-adapter/runtime';

// 加载 OpenClaw 插件
async function loadOpenClawPlugin(pluginPath: string) {
  // 动态导入插件
  const pluginModule = await import(pluginPath);
  const PluginClass = pluginModule.default || pluginModule.Plugin;
  
  // 创建运行时环境
  const runtime = createMinimalRuntime();
  
  // 实例化插件
  const plugin = new PluginClass({ runtime });
  
  // 使用适配器包装
  const adapter = new OpenClawChannelAdapter(plugin);
  
  // 注册到 ChannelRegistry
  channelRegistry.register(adapter);
  
  // 初始化
  if (adapter.setup) {
    await adapter.setup.initialize();
  }
  
  return adapter;
}
```

## 已知限制

### 当前版本不支持的功能

1. **完整的运行时接口** - 只实现了核心接口
2. **配对管理** - pairing 相关接口未实现
3. **媒体处理** - 媒体上传下载未实现
4. **会话管理** - 复杂的会话绑定未实现
5. **权限控制** - allowlist 等权限功能未实现

### 解决方案

- **方案 1：** 按需实现 - 当插件报错时，根据错误信息实现缺失的接口
- **方案 2：** 提供 mock - 对于不重要的接口，提供空实现或 mock
- **方案 3：** 修改插件 - 如果插件代码可修改，去掉不必要的依赖

## 测试清单

在适配插件后，需要测试以下功能：

- [ ] 插件能正常加载和初始化
- [ ] 能接收来自 jobopx-desktop 的任务通知
- [ ] 能发送消息到目标平台（飞书/钉钉等）
- [ ] 能接收来自目标平台的消息
- [ ] 能将用户命令转发到 jobopx-desktop
- [ ] 错误处理正常工作
- [ ] 连接断开后能自动重连

## 示例：适配飞书插件

```typescript
// 1. 安装飞书插件依赖
npm install @openclaw/feishu-plugin

// 2. 加载插件
import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');

// 3. 配置插件
feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');

// 4. 测试发送消息
await feishuPlugin.outbound.sendText({
  content: '测试消息',
});
```

## 故障排查

### 插件加载失败

1. 检查插件路径是否正确
2. 检查插件依赖是否安装
3. 查看错误堆栈，确定缺失的接口

### 消息发送失败

1. 检查插件配置（appId、appSecret 等）
2. 检查网络连接
3. 查看目标平台的 API 文档

### 接口不兼容

1. 查看错误信息，确定调用的接口
2. 在适配器中实现该接口
3. 如果接口复杂，提供简化版本

## 贡献指南

如果你成功适配了某个 OpenClaw 插件，欢迎贡献：

1. 记录需要实现的接口清单
2. 提供适配器代码
3. 编写测试用例
4. 更新本文档

## 参考资源

- [OpenClaw 官方文档](https://github.com/openclaw/openclaw)
- [OpenClaw Channel 接口定义](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)
- [飞书开放平台文档](https://open.feishu.cn/document/)
