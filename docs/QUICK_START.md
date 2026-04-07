# squid 快速使用指南

本文面向最终用户：在本地安装并运行 squid，完成模型配置后即可开始对话与任务。架构与扩展说明见 [developer-guide.md](./developer-guide.md)。

## 产品定位

squid 是一款 **本地运行的 AI 桌面工作台**，适用于：

- 在指定工作目录下做代码阅读、审查与轻量改写（受任务模式与沙箱约束）
- 结合技能与专家配置，完成文档整理、检索、结构化输出等任务
- 使用定时任务在本地按 Cron 触发模型执行
- 按需启用飞书、Telegram、微信等 **渠道扩展**（需单独配置，见 [channel-extensions.md](./channel-extensions.md)）

## 环境与启动

**自源码运行（推荐开发者）**

- Node.js 建议 22 LTS，npm；桌面壳依赖 Electrobun（`npm run dev` 时会按平台准备 CLI）。
- 项目根目录须存在 **`electrobun.config.ts`**（Electrobun 仅解析此文件名）。

```bash
cd squid
npm install
npm run dev
```

**发行包**

若从 GitHub Release 等渠道获取已构建安装包，按对应平台说明安装。macOS 未签名/未公证版本可能需在首次打开时使用右键「打开」或按系统提示放行；详见仓库根目录 [README.md](../README.md)。

## 配置 API 密钥

至少配置一种模型提供方（在应用内 **设置** 中填写并保存，密钥写入本机 `~/.squid/config.json`）：

| 提供方 | 说明 |
|--------|------|
| Anthropic | [Anthropic Console](https://console.anthropic.com/) 创建 API Key |
| OpenAI | [OpenAI Platform](https://platform.openai.com/) 创建 API Key |
| 兼容端点 | 在设置中填写自定义 Base URL 与模型名（需兼容当前应用所使用的协议） |

## 首次使用流程

1. 启动应用后打开侧栏 **「设置」**，保存模型与相关选项。
2. 在聊天或任务界面 **选择工作目录**（勿将不可信路径作为工作区根）。
3. **新建会话或任务**，选择模式：
   - **Ask**：偏只读与分析，默认不主动改写文件（具体以当前版本行为为准）。
   - **Craft**：允许工具链自动执行，可能修改工作区内文件。
   - **Plan**：偏规划与分步说明，适合复杂需求。
4. 按需选择 **技能** 或 **专家**。

## 渠道与飞书（可选）

- 侧栏 **「渠道」** 可查看内置 WebUI 与各扩展渠道状态。
- 飞书实现位于仓库 `extensions/feishu/`；默认是否在 `config/channel-extensions.json` 中启用以仓库为准。用户侧启用列表可写在 `~/.squid/channel-extensions.json`。
- 个人或第三方扩展可置于 `~/.squid/extensions/<目录>/`，细节见 [channel-extensions.md](./channel-extensions.md)。

飞书机器人创建、长连接与 Webhook、以及 `~/.squid/feishu-channel.json` 字段说明，仍以应用内文案与 [user-guide.md](./user-guide.md) 为准。

## 常见任务示例

**代码审查（Ask）**

```text
模式：Ask
工作目录：<你的项目路径>
指令：梳理 src 下主要模块职责，并列出可读性与明显缺陷方面的建议。
```

**批量文档（Craft）**

```text
模式：Craft
工作目录：<项目路径>
指令：为指定目录中的公开 API 生成 Markdown 说明草稿。
```

**定时任务**

在 **定时任务** 页面新建条目，填写 Cron 与触发后交给模型的内容；应用未运行时调度不会执行。

## 技能与专家

- **技能**：在界面中选择已安装技能；技能文件位于 `~/.squid/skills/`（含 SkillHub 等来源的安装结果）。
- **专家**：用于调整系统角色与边界；内置与自定义项在 **专家** 相关页面管理。

## 常见问题

**密钥是否只存在本机？**  
是。配置与密钥不应提交到 Git；请自行备份 `~/.squid`。

**任务会改文件吗？**  
取决于模式与工具策略：Ask 偏只读；Craft 可能写入；Plan 多为先说明再执行。请以界面提示为准。

**工作目录边界？**  
文件类工具通常限制在当前会话绑定的工作目录内，具体校验见权限与沙箱实现。

**如何停止运行中的任务？**  
在任务或会话界面使用停止/中断控件（名称以 UI 为准）。

**定时任务在关应用后还跑吗？**  
不会；调度依赖应用进程存活。

## 延伸阅读

| 文档 | 内容 |
|------|------|
| [user-guide.md](./user-guide.md) | 功能与界面说明 |
| [developer-guide.md](./developer-guide.md) | 目录结构与扩展 |
| [tool-development-guide.md](./tool-development-guide.md) | 内置工具开发约定 |
| [TEST_REPORT.md](./TEST_REPORT.md) | 自动化测试概览 |

问题反馈与贡献请通过仓库 Issue / Pull Request。
