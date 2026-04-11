# squid

squid is a locally run AI desktop workbench: chat with models in an app window, manage multiple sessions, assign a working directory per session, and connect Anthropic, OpenAI, or compatible APIs in Settings. Skills, memory, scheduled jobs, and channel capabilities such as Feishu, Telegram, and WeChat (enable and configure in the app) share one task pipeline. Your configuration and data are stored by default under **`~/.squid`** on this machine.

**Version**: 0.1.0  
**License**: MIT

---

## What you can do

- **Multi-session chat**: Organize conversations by thread and bind a working directory per session so you can work on a specific project or let the assistant read and write files within allowed scope.
- **Task modes**: Choose **Ask** (consultation and read-only analysis), **Craft** (tool chain execution), **Plan** (planning and decomposition), and others in the UI; exact behavior follows in-app descriptions.
- **Models and keys**: Enter API keys, model names, and custom base URLs in **Settings**; keys stay on this machine and are not distributed with the repository.
- **Skills**: Browse, install, and manage skills from the app (including sources such as Tencent SkillHub); installed content lives under `~/.squid/skills`.
- **Experts and memory**: Use built-in or custom “experts” to tune assistant style and boundaries; long-term memory can be inspected and maintained separately.
- **Scheduled jobs**: Run on a Cron expression locally, hand specified content to the model, and keep execution history.
- **Channels**: Besides the main UI, enable Feishu, Telegram, WeChat personal account, and other extensions (configure in channel settings; some require extra login or webhooks—see `docs` and each channel’s notes).

---

## Install and run

**From source (developers or self-build)**

- **Node.js** (22 LTS recommended) and **npm**; the desktop shell uses **Electrobun**, with support for macOS 14+, Windows 11+, and Linux per upstream docs.

```bash
cd squid
npm install
npm run dev
```

**Release builds**

- If the project publishes GitHub Release artifacts, install or extract for your OS; unsigned / un-notarized macOS builds may be blocked on first open—use **Privacy & Security** as needed.

---

## First-time suggestions

1. Open **Settings**, configure the model and channels as needed, and save.  
2. In the chat area, **choose a working directory** (do not use an untrusted path as the workspace root).  
3. **Start a new session** with a short request; add skills, schedules, or channels when you need automation.

For more UI flow, see **[QUICK_START.md](./QUICK_START.md)** and **[user-guide.md](./user-guide.md)**.  
For multilingual docs (Chinese, English, Japanese, Russian, Italian, French, German), open **[../index.html](../index.html)** and switch language.

---

## Where data is stored

| Location | Meaning |
|----------|---------|
| `~/.squid/config.json` | Main settings: model keys, UI flags, some feature toggles |
| `~/.squid/skills/` | Installed skill files |
| Other JSON under `~/.squid` | Per-module config and data for channels, memory, etc. (created as you use features) |

Back up this directory yourself; do not commit secrets to a public repo. Some extensions (e.g. WeChat personal) may require **`npm run weixin-personal:login`** from a source checkout—follow that extension’s documentation.

---

## Security notes

- If the assistant has file or command capabilities, scope is constrained by the **working directory** and built-in rules; do not point the default workspace at sensitive system paths.  
- The app exposes a local service for UI ↔ main process communication; normal use does not open the LAN or public internet—if you add port forwarding or reverse proxies, apply your own authentication and access control.

---

## Developing from source (brief)

squid uses **Electrobun**: Bun runs the main process and local services; the UI runs in the system WebView. If you develop from a **cloned repo root** and need bundled channel extensions, set **`SQUID_ROOT`** to that repo root so the app can find `config/channel-extensions.json`; end users of installers do not need this. Module layout, extensions, and tool conventions are in **[developer-guide.md](./developer-guide.md)** and **[tool-development-guide.md](./tool-development-guide.md)**.

---

## Other documentation

| Doc | Audience |
|-----|----------|
| [QUICK_START.md](./QUICK_START.md) | Get productive quickly |
| [user-guide.md](./user-guide.md) | Full tour of menus and features |
| [developer-guide.md](./developer-guide.md) | Development and extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Built-in tool authoring |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Version changes |
| [TEST_REPORT.md](./TEST_REPORT.md) | Tests and quality notes |

---

## License

This project is released under the **MIT License**.
