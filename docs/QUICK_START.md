# Jobopx Desktop 快速使用指南

## 🎯 这是什么？

Jobopx Desktop 是一个 **AI 助手桌面应用**，可以帮你：
- 📝 自动生成文档、代码、报告
- 🔍 分析数据、审查代码
- 📁 整理文件、生成测试
- ⏰ 定时执行任务（比如每天早上生成 AI 新闻摘要）
- 🌐 远程控制（通过 API 调用）

## 🚀 5 分钟上手

### 第 1 步：安装依赖

```bash
cd jobopx-desktop
npm install
```

### 第 2 步：配置 API 密钥

你需要至少一个 AI 模型的 API 密钥：

**选项 1: Anthropic Claude（推荐）**
- 访问 https://console.anthropic.com/
- 创建 API Key
- 复制密钥

**选项 2: OpenAI GPT**
- 访问 https://platform.openai.com/
- 创建 API Key
- 复制密钥

**选项 3: DeepSeek**
- 访问 https://platform.deepseek.com/
- 创建 API Key
- 复制密钥

### 第 3 步：启动应用

```bash
npm run dev
```

应用会打开一个桌面窗口。

### 第 4 步：首次配置

1. 点击左侧边栏的 **"设置"**
2. 在 "API 密钥" 部分输入你的密钥
3. 点击 **"保存设置"**

飞书等渠道：可在侧栏 **「渠道」** 中查看各 Channel 健康状态，并在飞书详情页编辑配置（凭证经 API 脱敏返回）。飞书实现位于 **`extensions/feishu/`**，由 `config/channel-extensions.json` 默认 `enabled: ["feishu"]` 加载；若删除该配置且未在 `~/.squid/channel-extensions.json` 中启用飞书，**飞书 Channel 不会注册**。个人插件可放在 **`~/.squid/extensions/<插件目录>/`**（存在该目录即自动参与扫描，无需写进 `roots`；`enabled` 白名单仍生效）。详见 [channel-extensions.md](./channel-extensions.md)。

### 第 5 步：创建第一个任务

1. 点击 **"新建任务"** 按钮
2. 选择模式：
   - **Ask 模式**：只查询，不修改文件（安全）
   - **Craft 模式**：AI 自动执行（快速）
   - **Plan 模式**：先看计划，确认后执行（谨慎）
3. 选择 AI 模型（比如 Claude Sonnet 4）
4. 指定工作目录（比如 `/Users/你的用户名/Documents/test`）
5. 输入任务，比如：
   ```
   帮我分析这个目录下的所有 JavaScript 文件，
   找出可能的性能问题
   ```
6. 点击 **"创建任务"**

AI 就会开始工作了！

## 💡 常见使用场景

### 场景 1：代码审查

```
任务模式：Ask
工作目录：你的项目目录
指令：审查 src/ 目录下的代码，找出潜在的 bug 和改进建议
```

### 场景 2：自动生成文档

```
任务模式：Craft
工作目录：你的项目目录
指令：为 src/api/ 目录下的所有函数生成 API 文档
```

### 场景 3：数据分析

```
任务模式：Ask
工作目录：包含数据文件的目录
技能：选择 "数据分析"
指令：分析 data.csv 文件，生成统计报告
```

### 场景 4：定时任务

1. 点击左侧 **"定时任务"**
2. 点击 **"新建定时任务"**
3. 选择预设模板，比如 **"每日 AI 新闻摘要"**
4. 设置执行时间（比如每天早上 9 点）
5. 启用任务

每天早上 9 点，AI 会自动搜索并总结最新的 AI 新闻！

## 🎭 使用技能和专家

### 使用技能

技能是预设的任务模板，让 AI 更专业：

1. 创建任务时，点击 **"选择技能"**
2. 选择合适的技能：
   - 📊 数据分析
   - 📝 文档生成
   - 🔍 代码审查
   - 📁 文件整理
   - 等等...
3. AI 会使用该技能的专业提示词

### 使用专家

专家是不同的角色视角：

1. 创建任务时，点击 **"选择专家"**
2. 选择合适的专家：
   - 👨‍💻 软件工程师
   - 📊 数据分析师
   - 🎨 UI 设计师
   - 📱 产品经理
   - 等等...
3. AI 会以该专家的视角回答

## 🌐 远程控制（高级）

你可以通过 HTTP API 远程控制 Jobopx：

### 1. 生成 Token

在设置页面，点击 **"生成新 Token"**，复制 Token。

### 2. 启动 Claw 服务器

```bash
# 在代码中启动（默认端口 3000）
```

### 3. 远程创建任务

```bash
curl -X POST http://localhost:3000/task \
  -H "Authorization: Bearer 你的TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "分析项目代码质量",
    "workDir": "/path/to/project"
  }'
```

### 4. 查询任务状态

```bash
curl http://localhost:3000/task/任务ID \
  -H "Authorization: Bearer 你的TOKEN"
```

## 🔌 连接外部服务（MCP）

Jobopx 可以连接 GitHub、Slack、Notion、Jira：

### 连接 GitHub

1. 点击左侧 **"连接器"**
2. 找到 **GitHub** 连接器
3. 点击 **"配置"**
4. 输入你的 GitHub Personal Access Token
5. 点击 **"连接"**

现在 AI 可以：
- 读取你的仓库
- 创建 Issue
- 查看 PR
- 等等...

### 连接 Notion

1. 在 Notion 中创建 Integration
2. 获取 API Key
3. 在 Jobopx 中配置 Notion 连接器
4. AI 就可以读写你的 Notion 页面了！

### 飞书 / Lark 机器人（可选）

1. 在[飞书开放平台](https://open.feishu.cn/app)创建企业自建应用，开通机器人与 **「接收消息」**（`im.message.receive_v1`）等事件权限，取得 **App ID / App Secret**，并记录事件订阅里的 **Encrypt Key**、**Verification Token**（与控制台一致）。
2. **推荐：长连接（WebSocket）入站（默认，无需公网地址与穿透）**  
   在开放平台「事件订阅」中将接收方式设为 **使用长连接**（或等价选项）。squid 启动后会用官方 SDK **主动连接飞书**，本机只需能访问外网即可，**不要**再配置请求 URL / 内网穿透。  
   若必须使用 HTTP 回调，可在 `feishu-channel.json` 中设置 **`"connectionMode": "webhook"`**，并将事件 URL 指向 **`http://<可达主机>:50001/api/feishu/webhook`**（该模式才需要公网或穿透）。
3. 在本地创建或写入 **`~/.squid/feishu-channel.json`**（亦可通过 `POST /api/channels/feishu/config` 保存），至少包含：
   - `appId`、`appSecret`
   - `encryptKey`（与控制台一致；长连接与加密事件解密依赖此项）
   - `verificationToken`（与控制台一致）
   - `defaultReceiveId`（如群 `chat_id`）、`defaultReceiveIdType`（一般为 `chat_id`）
   - 可选：`connectionMode`（默认 **`websocket`**）、`feishuDomain`（国际 Lark 填 **`lark`**）
4. 重启应用；若出站配置完整，启动日志会出现「已注册 Feishu Channel」「Feishu ↔ squid 入站桥接已注册」及 **「正在建立飞书事件长连接」**。在飞书会话里发消息 → **长连接入站** → **自动走 squid 的 ask 流式任务**，回复发回同一聊天（需已配置模型 API Key 与工作区）。

## ❓ 常见问题

**Q: 我的 API 密钥安全吗？**  
A: 是的！密钥使用 AES-256-GCM 加密存储在本地。

**Q: 任务会修改我的文件吗？**  
A: 取决于模式：
- Ask 模式：只读，不会修改
- Craft 模式：会自动修改
- Plan 模式：先给你看计划，你确认后才修改

**Q: 工作目录有什么限制？**  
A: 所有文件操作都限制在你指定的工作目录内，无法访问其他目录。

**Q: 如何停止正在运行的任务？**  
A: 点击任务旁边的 **"停止"** 按钮。

**Q: 定时任务会一直运行吗？**  
A: 只有在应用运行时才会执行。关闭应用后，定时任务会暂停。

## 📚 更多资源

- [完整用户文档](docs/user-guide.md)
- [开发者文档](docs/developer-guide.md)
- [测试报告](TEST_REPORT.md)

## 🆘 需要帮助？

- 查看文档
- 提交 Issue
- 加入讨论

---

**开始使用吧！** 🚀
