# squid

squid is a locally run AI desktop workbench: chat with models in an app window, manage multiple sessions, assign a working directory per session, and connect Anthropic, OpenAI, or compatible APIs in Settings. Skills, memory, scheduled jobs, and channel capabilities such as Feishu, Telegram, and WeChat (enabled and configured in-app) all run through one task pipeline. Your configuration and data are stored by default under **`~/.squid`** on this machine.

**Version**: 0.1.0  
**License**: MIT

**Documentation languages**:  
[English](docs/locales/en/README.md) | [中文](docs/locales/zh/README.md) | [日本語](docs/locales/ja/README.md) | [Русский](docs/locales/ru/README.md) | [Italiano](docs/locales/it/README.md) | [Français](docs/locales/fr/README.md) | [Deutsch](docs/locales/de/README.md)

---

## What you can do

- **Multi-session chat**: Organize conversations by thread and bind a working directory per session so you can work on a specific project or let the assistant read and write files within allowed scope.
- **Task modes**: Choose **Ask** (consultation and read-only analysis), **Craft** (tool-chain execution), **Plan** (planning and decomposition), and others in the UI; exact behavior follows in-app descriptions.
- **Models and keys**: Enter API keys, model names, and custom base URLs in **Settings**; keys stay on this machine and are not distributed with the repository.
- **Skills**: Browse, install, and manage skills from the app (including sources such as Tencent SkillHub); installed content lives under `~/.squid/skills`.
- **Experts and memory**: Use built-in or custom experts to tune assistant style and boundaries; long-term memory can be inspected and maintained separately.
- **Scheduled jobs**: Run jobs locally using Cron expressions, submit specified content to the model, and keep execution history.
- **Channels**: Besides the main UI, enable Feishu, Telegram, WeChat personal account, and other extension channels (configure in channel settings; some require additional login or webhooks, see `docs` and channel-specific docs).

---

## Install and run

**From source (developers or self-build)**

- Requires **Node.js** (22 LTS recommended) and **npm**; desktop shell uses **Electrobun**, supporting macOS 14+, Windows 11+, and Linux environments listed in upstream docs.

```bash
cd squid
npm install
npm run dev
```

**Release builds**

- If GitHub Release artifacts are published, download and install/extract the package for your OS. Unsigned or non-notarized macOS builds may be blocked on first launch; allow them in **Privacy & Security** when needed.

---

## First-time setup

1. Open **Settings**, configure model and channels as needed, then save.  
2. In the chat area, **choose a working directory** (do not use untrusted paths as workspace root).  
3. **Start a new session** with a short prompt, then add skills/schedules/channels when automation is needed.

For detailed UI and flow guidance, see **[docs/QUICK_START.md](docs/QUICK_START.md)** and **[docs/user-guide.md](docs/user-guide.md)**.  
For multilingual docs (zh/en/ja/ru/it/fr/de), open **[docs/index.html](docs/index.html)** and switch language.

---

## Where data is stored

| Location | Meaning |
|----------|---------|
| `~/.squid/config.json` | Main settings: model keys, UI flags, and feature toggles |
| `~/.squid/skills/` | Installed skill files |
| Other JSON under `~/.squid` | Module-specific config/data for channels, memory, etc. |

Back up this directory yourself. Do not commit secrets to public repositories. Some extensions (for example WeChat personal account) may also require running **`npm run weixin-personal:login`** in a source checkout; follow the extension docs.

---

## Security notes

- If the assistant can access files or commands, scope is constrained by the **working directory** and built-in rules. Do not set sensitive system paths as default workspace.  
- The app provides a local service for UI and main-process communication. It does not expose LAN/public access by default; if you add reverse proxies or port forwarding, apply your own authentication and access control.

---

## Developing from source (brief)

squid uses **Electrobun**: Bun runs the main process and local services, while UI is rendered in system WebView. If you develop from a cloned repo root and need bundled channel extensions, set **`SQUID_ROOT`** to that repo root so the app can discover `config/channel-extensions.json`. End users running installer builds do not need this. For module layout, extension architecture, and tool conventions, see **[docs/developer-guide.md](docs/developer-guide.md)** and **[docs/tool-development-guide.md](docs/tool-development-guide.md)**.

---

## Other docs

| Doc | Audience |
|-----|----------|
| [docs/QUICK_START.md](docs/QUICK_START.md) | Quick onboarding |
| [docs/user-guide.md](docs/user-guide.md) | Full feature walkthrough |
| [docs/developer-guide.md](docs/developer-guide.md) | Development and extension work |
| [docs/tool-development-guide.md](docs/tool-development-guide.md) | Built-in tool authoring |
| [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | Version changes |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | Testing and quality notes |

---

## License

This project is released under the **MIT License**.
