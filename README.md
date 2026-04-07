# squid

squid 是一款本地运行的 AI 桌面工作台：在应用窗口里与模型对话、管理多个会话、为每个会话指定工作目录，并可在设置中接入 Anthropic、OpenAI 或兼容接口。技能、记忆、定时任务以及飞书、Telegram、微信等渠道能力（需在应用内启用并配置）都围绕同一条任务流水线工作。你的配置与数据默认保存在本机用户目录下的 **`~/.squid`**。

**版本**：0.1.0  
**许可证**：MIT

---

## 你能做什么

- **多会话聊天**：按线程组织对话，并为会话绑定工作目录，便于围绕具体项目提问或让助手读写允许范围内的文件。
- **任务模式**：在界面中选择适合当前目标的 **Ask**（偏咨询与只读分析）、**Craft**（可执行工具链）、**Plan**（偏规划与拆解）等模式；具体行为以应用内说明为准。
- **模型与密钥**：在**设置**里填写 API Key、模型名称与自定义接口地址；密钥只保存在本机，不会随仓库分发。
- **技能**：从应用内浏览、安装与管理技能（含腾讯 SkillHub 等来源）；已安装内容位于 `~/.squid/skills`。
- **专家与记忆**：使用预设或自定义「专家」调整助手风格与边界；长期记忆可单独查看与维护。
- **定时任务**：按 Cron 表达式在本地定时触发，将指定内容交给模型处理，并保留执行记录。
- **渠道**：除主界面外，可启用飞书、Telegram、微信个人号等扩展渠道（需在渠道设置中完成配置；部分渠道需额外登录或 Webhook，详见 `docs` 与各渠道说明）。

---

## 安装与启动

**从源码运行（开发者或自行构建）**

- 需要已安装 **Node.js**（建议 22 LTS）与 **npm**；桌面壳依赖 **Electrobun**，支持 macOS 14+、Windows 11+ 及官方说明中的 Linux 环境。
- 克隆仓库后在项目根目录执行：

```bash
cd squid
npm install
npm run dev
```

**使用发行包**

- 若仓库已提供 GitHub Release 等安装包，请直接下载对应系统的制品安装或解压后运行；macOS 未签名/未公证版本可能在首次打开时被系统拦截，需在「隐私与安全性」中按需放行。

---

## 首次使用建议

1. 打开**设置**，完成模型与（如需要）渠道的配置并保存。  
2. 在聊天区域**选择工作目录**（勿将不可信目录作为工作区）。  
3. **新建会话**，用简短需求试跑一轮；需要自动化时再尝试技能、定时任务或渠道。

更细的界面与流程说明见 **[docs/QUICK_START.md](docs/QUICK_START.md)** 与 **[docs/user-guide.md](docs/user-guide.md)**。

---

## 数据保存在哪里

| 位置 | 对用户意味着什么 |
|------|-------------------|
| `~/.squid/config.json` | 模型密钥、界面与部分功能开关等主配置 |
| `~/.squid/skills/` | 已安装的技能文件 |
| `~/.squid` 下其它 JSON | 渠道扩展、记忆等模块各自的配置与数据（随功能使用而生成） |

请自行备份该目录；勿把其中密钥文件提交到公开仓库。若使用微信个人号等扩展，可能还需在终端执行 **`npm run weixin-personal:login`**（仅在你从源码目录维护扩展时），具体以扩展文档为准。

---

## 安全提示

- 助手若具备文件或命令类能力，其可操作范围受**工作目录**与内置规则约束；请勿把系统敏感目录当作默认工作区。  
- 应用会在本机提供仅供界面与主进程通信的本地服务；正常使用不会主动对局域网或公网开放，若你自行做端口转发或反向代理，请自行做好认证与访问控制。

---

## 从源码参与开发时（简要）

squid 采用 **Electrobun**：主进程与本地服务由 Bun 侧运行，界面在系统 WebView 中展示。若你在**克隆的仓库根目录**下开发并需要加载仓库自带的渠道扩展，可设置环境变量 **`SQUID_ROOT`** 指向该仓库根（使程序能发现其中的 `config/channel-extensions.json`）；日常用户从安装包运行时无需关心此项。模块划分、扩展与工具约定见 **[docs/developer-guide.md](docs/developer-guide.md)** 与 **[docs/tool-development-guide.md](docs/tool-development-guide.md)**。

---

## 其它文档

| 文档 | 适合谁 |
|------|--------|
| [docs/QUICK_START.md](docs/QUICK_START.md) | 想尽快跑通功能 |
| [docs/user-guide.md](docs/user-guide.md) | 想系统了解各菜单与能力 |
| [docs/developer-guide.md](docs/developer-guide.md) | 参与开发与扩展 |
| [docs/tool-development-guide.md](docs/tool-development-guide.md) | 编写或修改内置工具 |
| [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | 版本变更说明 |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | 测试与质量说明 |

---

## 许可

本项目以 **MIT License** 发布。
