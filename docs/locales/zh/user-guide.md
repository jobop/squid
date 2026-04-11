# squid 用户说明

本文描述 squid 桌面端的主要能力与使用方式；与源码、测试不一致之处以当前版本代码与界面为准。

## 安装与启动

**自源码**

```bash
cd squid
npm install
npm run dev
```

**说明**：`npm run build` 为 TypeScript 编译；`npm start` 对应 `node dist/main.js`，与 Electrobun 桌面主路径不同。日常桌面开发请使用 `npm run dev`。

**发行包**  
使用各平台构建产物安装或解压运行；macOS 安全提示与隔离属性处理见 [README.md](./README.md) 或仓库根目录 [README.md](../../../README.md)。

## 设置

首次使用请完成：

1. 打开侧栏 **设置**。
2. 配置 **Anthropic / OpenAI / 兼容端点** 的密钥、模型与 Base URL（如适用）。
3. 保存；配置写入 `~/.squid/config.json`。

可选：渠道相关选项、界面偏好等（以实际设置页分组为准）。

## 任务与会话

### 任务模式

| 模式 | 适用场景 |
|------|----------|
| Ask | 咨询、只读分析、尽量少改动工作区文件 |
| Craft | 需要工具自动执行、可能创建或修改工作区内文件 |
| Plan | 复杂任务：先产出计划或步骤，再按确认执行 |

### 创建流程（概览）

1. 选择 **新建任务** 或等价入口。
2. 选择模式、模型、**工作目录**（必选且应可信）。
3. 可选：技能、专家。
4. 输入自然语言指令并提交。

工作目录外的路径通常受沙箱拒绝；请勿将系统敏感目录设为工作区。

## 技能

- 预置与已安装技能在任务创建或设置中选用。
- 技能内容存放于 `~/.squid/skills/`（目录或单文件布局由加载器支持）。
- 腾讯 SkillHub 等外部来源的安装与元数据路径见 [tencent-skillhub.md](./tencent-skillhub.md)。

## 专家

内置多种角色模板，用于调整回答风格与专业边界；可在专家中心查看与切换。自定义专家能力以当前版本为准。

## 定时任务

1. 进入 **定时任务** 页面。
2. 新建条目：填写 Cron 表达式、触发后交给模型的内容及其它选项。
3. 启用后仅在 **应用运行期间** 调度；关闭应用后暂停。

预设模板（如日报摘要、仓库巡检等）若提供，可在新建向导中选择。

## 渠道（Channel）

- **WebUI**：主界面聊天与任务，与执行引擎通过内置通道通信。
- **扩展渠道**：飞书、Telegram、微信个人号等，位于仓库 `extensions/` 与用户 `~/.squid/extensions/`，经 `channel-plugin.json` 声明；启用与表单配置见 [channel-extensions.md](./channel-extensions.md)。

飞书侧需开放平台应用、事件订阅（长连接或 Webhook）、以及本地 `~/.squid/feishu-channel.json` 等配置；HTTP 回调模式下事件 URL 需指向本机可达地址，详见 [QUICK_START.md](./QUICK_START.md) 与 `extensions/feishu` 说明。

## 记忆

长期记忆可在专用界面查看与编辑；存储位置在 `~/.squid` 下由实现决定。测试环境可通过环境变量覆盖记忆目录（见开发者文档）。

## Claw 与本地 API（进阶）

- 主桌面入口内嵌 **本地 HTTP API**（默认与 UI 同机通信），用于任务执行与流式输出等；勿在未加固时暴露到公网。
- `src/claw` 下另有 Claw 相关 HTTP 服务实现；是否在默认桌面启动流程中启用以 `src/bun/index.ts` 当前逻辑为准。远程调用、Token 与路由以代码与测试为准。

## 数据与备份

| 路径 | 内容 |
|------|------|
| `~/.squid/config.json` | 主配置与模型密钥等 |
| `~/.squid/skills/` | 技能 |
| `~/.squid/channel-extensions.json` | 用户侧渠道扩展启用等 |
| `~/.squid/extensions/` | 用户扩展根目录之一 |

定期备份整个 `~/.squid`；勿将密钥提交到版本库。

## 常见问题

**如何切换默认模型？**  
在设置中修改默认项，或在单次任务创建时覆盖选择。

**能否访问工作目录外文件？**  
默认不能；依赖沙箱与权限规则。

**卸载或迁移？**  
退出应用后备份或删除 `~/.squid`；迁移时在新机器还原该目录并重新安装应用。

## 相关文档

- [QUICK_START.md](./QUICK_START.md)：最短路径上手  
- [developer-guide.md](./developer-guide.md)：开发者与扩展  
- [tool-development-guide.md](./tool-development-guide.md)：工具规范  
- [TEST_REPORT.md](./TEST_REPORT.md)：测试报告  
