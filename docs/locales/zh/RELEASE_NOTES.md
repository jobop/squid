# squid v0.1.0 发布说明

## 最近更新（2026-04-10）

### 渠道图片识别链路补齐

- Telegram / Feishu / 微信个人号入站图片统一走「下载到 workspace + `mentions(file)`」链路。
- 渠道繁忙入队场景保留同一 `mentions`，避免图片在队列路径丢失。
- 新增扩展侧共享落盘能力：`extensions/shared/workspace-image-store.ts`。

### Channel 打断命令 `/wtf`

- 在 `TaskAPI.executeTaskStream` 新增 `/wtf` 命令，语义与 Web ESC 一致：仅中断当前会话运行中的任务，不清队列。
- `/wtf` 分支位于会话 busy 检查之前，保证「会话忙时」也能即时触发中断，不会被先拦成 busy。
- Telegram / Feishu / 微信桥接测试已补齐，验证 `/wtf` 会透传到统一命令分支。

## 概述

squid 首个对外版本：基于 Electrobun 的本地 AI 桌面工作台，集成多模型对话、任务模式、技能与专家、定时任务及可扩展渠道（飞书 / Telegram / 微信等，按需启用）。

## 核心能力

### 任务与工作区

- 任务模式：Ask（偏只读）、Craft（可自动执行工具）、Plan（偏规划与确认）
- 任务状态机与持久化
- 工作目录绑定与路径沙箱

### 模型

- Anthropic Claude 系列（以设置中可选模型为准）
- OpenAI 兼容接口
- DeepSeek 等兼容端点（取决于当前适配器与设置）
- 流式输出与 Token 统计（以实际实现为准）
- 本地加密存储 API 密钥

### 技能与专家

- 多套内置技能模板；支持从 `~/.squid/skills` 加载与 SkillHub 等来源安装
- 多种内置专家角色与自定义扩展点

### 渠道

- 内置 WebUI 渠道
- 扩展渠道：`extensions/` 与 `~/.squid/extensions`，声明式配置与桥接 TaskAPI

### Claw 与自动化

- Claw 相关 HTTP 能力与 Token 设计见 `src/claw`；默认桌面入口是否启用 Claw 服务以 `src/bun/index.ts` 为准
- 基于 node-cron 的定时任务与执行历史

### 桌面壳

- Electrobun：Bun 主进程 + 系统 WebView
- 主界面布局、设置页、任务与会话 UI

## 测试

最近一次记录的自动化测试：9 个测试文件、31 条用例通过（详见 [TEST_REPORT.md](./TEST_REPORT.md)）。发布前请在目标环境执行 `npm test` 复核。

## 安装与命令（源码）

```bash
git clone <repository-url>
cd squid
npm install
npm test          # 可选
npm run dev       # 桌面开发
npm run build     # tsc
npm run build:electron:release   # 稳定通道桌面制品（输出 artifacts/）
```

## 配置

首次运行：在应用 **设置** 中填写模型密钥并保存。渠道与飞书等：见 [QUICK_START.md](./QUICK_START.md)、[channel-extensions.md](./channel-extensions.md)。

**构建注意**：Electrobun **仅读取 `electrobun.config.ts`**；缺少该文件或误用 `.js` 将导致 stable 包未拷贝 `public`，界面白屏。

## 文档索引

- [user-guide.md](./user-guide.md)
- [developer-guide.md](./developer-guide.md)
- [TEST_REPORT.md](./TEST_REPORT.md)
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

## 安全

- 工作区路径校验与工具权限分类
- 密钥本地加密存储
- 本地 HTTP 服务默认不应暴露公网

## 已知限制

- 部分 UI 与选择器仍在迭代（以 Issue 与里程碑为准）
- macOS 公开发行的未签名/未公证制品可能触发 Gatekeeper；分发建议采用 Developer ID 签名与公证

## 后续方向（规划）

- 完善技能与渠道生态、设置与可观测性
- 性能与体验优化

## 许可证

MIT License

---

**发布日期**：2026-04-04（随仓库维护更新）  
**版本**：v0.1.0  
**状态**：维护中
