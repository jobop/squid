# squid

<div align="center">

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**基于 Electrobun 的 AI 桌面工作台**

多模型对话、技能与专家、记忆、定时任务与本地 HTTP API

[快速开始](#快速开始) · [功能](#功能) · [文档](#文档) · [开发与测试](#开发与测试)

</div>

---

## 概述

**squid** 是一款面向日常开发与办公的桌面端 AI 助手：在本地 WebView 中聊天、管理线程与工作目录，通过统一执行器调用工具与技能，并支持 Cron 调度与长期记忆。应用数据默认存放在用户主目录下的 **`~/.squid`**（配置、会话、技能、记忆等）。

> 本仓库目录名为 `squid`，产品对外名称为 **squid**。

## 功能

| 领域 | 说明 |
|------|------|
| 模型 | 支持 Anthropic、OpenAI 及兼容 OpenAI/Anthropic 协议的自定义端点 |
| 模式 | Ask / Craft / Plan 等任务模式（只读、自动执行、预览等） |
| 技能 | 本地技能目录加载、腾讯 SkillHub 浏览与安装 |
| 专家 | 预设与自定义专家角色，用于调整系统行为 |
| 记忆 | 长期记忆 CRUD、可选对话提取与自动管理 |
| 线程 | 多会话线程、按线程工作目录 |
| 调度 | 基于 node-cron 的定时任务与执行历史 |
| 集成 | MCP 连接管理、Channel 扩展（参考 OpenClaw 适配层） |
| API | 本地 HTTP 服务（默认端口见 `src/bun/index.ts`），供 UI 与自动化调用 |

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) 或 Node（以你本机 `npm run dev` 实际为准）
- macOS / Windows / Linux（Electrobun 支持的平台）

### 安装与启动

```bash
cd squid
npm install
npm run dev
```

### 配置模型

1. 启动应用后打开**设置**。
2. 填写 API Key、模型名与端点并保存。

常用密钥来源（任选其一或组合）：

- [Anthropic Console](https://console.anthropic.com/)
- [OpenAI Platform](https://platform.openai.com/)

### 第一次使用建议

1. 在设置中保存模型配置。
2. 在聊天页选择工作目录（可使用系统目录选择器）。
3. 新建线程，输入任务说明并发送。

更详细的步骤见 [快速使用指南](docs/QUICK_START.md)。

## 使用示例

**代码审查（Ask）**

```text
模式：Ask
指令：审查当前工作目录下主要源码，列出明显问题与改进建议。
```

**结合技能（Craft）**

```text
模式：Craft
技能：（在 UI 中选择已安装技能）
指令：按技能说明完成指定任务。
```

**定时任务**

```text
使用应用内定时任务能力，按 Cron 表达式在固定时间触发，将给定内容作为 prompt 交给模型执行。
```

## 文档

| 文档 | 说明 |
|------|------|
| [docs/QUICK_START.md](docs/QUICK_START.md) | 快速上手 |
| [docs/user-guide.md](docs/user-guide.md) | 用户功能说明 |
| [docs/developer-guide.md](docs/developer-guide.md) | 架构与扩展 |
| [docs/tool-development-guide.md](docs/tool-development-guide.md) | 工具开发规范 |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | 测试与质量相关说明 |
| [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | 版本说明 |

## 开发与测试

```bash
npm test          # Vitest
npm run build     # TypeScript 编译（tsc）
npm run build:electron   # Electrobun 打包（需本机环境就绪）
```

## 技术栈

- **运行时 / 桌面壳**：Bun、Electrobun、系统 WebView
- **语言**：TypeScript
- **AI**：`@anthropic-ai/sdk`、`openai`（及自定义兼容端点）
- **校验与工具**：Zod、glob、node-cron、MCP SDK 等
- **测试**：Vitest

## 安全说明

- 工作目录与文件类工具在沙箱路径校验下执行。
- 敏感配置可使用项目内安全存储机制（见源码 `secure-storage` 与设置流程）。
- 本地 API 仅监听本机，部署或暴露到网络前请自行加固。

## 路线图（简要）

- **近期**：UI 与交互持续打磨、技能与工具生态完善。
- **后续**：插件化、同步与协作能力（视需求排期）。

## 贡献

欢迎通过 Issue / PR 参与。扩展工具与 Channel 前请先阅读 [工具开发指南](docs/tool-development-guide.md) 与 [开发者文档](docs/developer-guide.md)。

## 许可证

MIT License

---

<div align="center">

squid · AI desktop workbench

[回到顶部](#squid)

</div>
