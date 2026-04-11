# squid 项目概览

本文档概括仓库能力边界与模块划分，供产品与技术评审使用；与实现不一致时以源码为准。

## 定位

squid：本地优先的 AI 桌面工作台（Electrobun + Bun + 系统 WebView）。数据默认位于用户目录 `~/.squid`。

## 已实现能力（摘要）

### 任务与上下文

- 任务数据模型与 Ask / Craft / Plan 状态机  
- 上下文压缩与任务持久化  
- 权限与工具风险分类  

### 模型

- Anthropic、OpenAI、DeepSeek 等适配与注册表（以 `src/models` 为准）  
- 流式输出、Token 统计、密钥加密存储  

### 工作区与工具

- 工作目录绑定、路径沙箱  
- ReadFile、WriteFile、Glob、Grep 及统一工具结果映射与体积限制  

### 技能与专家

- 技能 YAML、加载器、白名单与 Hooks  
- 内置技能与专家模板；UI 侧部分能力仍在迭代  

### Claw 与调度

- Claw HTTP 服务与任务处理（`src/claw`）；桌面默认是否启用见 `src/bun/index.ts`  
- node-cron 定时任务、执行历史、邮件类通知（若配置）  

### 渠道

- Channel 注册表、内置 WebUI  
- 扩展渠道：`extensions/` + 用户目录，声明式 manifest 与 TaskAPI 桥接  
- EventBridge、WebSocket 等与 UI 的集成（见 [webui-channel.md](./webui-channel.md) 等）  

### 桌面与前端

- React 主界面、设置、任务与会话相关页面  
- 本地 HTTP API（主进程 `Bun.serve`，供 UI 调用）  

### 质量

- Vitest 单元与集成类用例（见 [TEST_REPORT.md](./TEST_REPORT.md)）  
- 用户文档与开发者文档位于 `docs/`；中文见 `docs/locales/zh/`  

## 测试与质量门禁

最近一次归档：9 个测试文件、31 条用例通过（见 TEST_REPORT）。合并前建议本地执行 `npm test`。

## 安全（摘要）

- 路径沙箱与工具只读/破坏性标记  
- 密钥 AES-256-GCM 等本地保护（以 `secure-storage` 实现为准）  
- Claw Token 与权限引擎（若启用相关路径）  

## 性能（摘要）

- LRU、虚拟滚动、懒加载、流式响应、上下文压缩等（以具体模块为准）  

## 文档

| 文档 | 用途 |
|------|------|
| [QUICK_START.md](./QUICK_START.md) | 用户快速上手 |
| [user-guide.md](./user-guide.md) | 功能说明 |
| [developer-guide.md](./developer-guide.md) | 架构与扩展 |
| [tool-development-guide.md](./tool-development-guide.md) | 工具开发规范 |
| [TEST_REPORT.md](./TEST_REPORT.md) | 测试报告 |

## 版本状态

当前仓库版本号以 `package.json` 为准；发布说明见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。
