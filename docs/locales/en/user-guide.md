# squid user guide

Major desktop capabilities and workflows; when this diverges from code or automated tests, trust the shipping build.

## Install and launch

**From source**

```bash
cd squid
npm install
npm run dev
```

**Notes**: `npm run build` runs the TypeScript compiler; `npm start` maps to `node dist/main.js`, which is **not** the Electrobun desktop path—use `npm run dev` for day-to-day UI work.

**Release builds**  
Follow platform packaging instructions; macOS quarantine/Gatekeeper guidance lives in the repository [README.md](./README.md).

## Settings

First-time checklist:

1. Open **Settings** from the sidebar.  
2. Configure **Anthropic / OpenAI / compatible endpoints** (keys, models, base URLs).  
3. Save—values persist to `~/.squid/config.json`.

Optional groups cover channels, UI preferences, and more (exact sections follow the current build).

## Tasks and sessions

### Task modes

| Mode | When to use |
|------|-------------|
| Ask | Consultation, read-only analysis, minimal file mutation |
| Craft | Tool execution that may create or edit workspace files |
| Plan | Complex work: produce a plan or checklist before deeper execution |

### Typical creation flow

1. Choose **New task** (or equivalent).  
2. Pick mode, model, and a **trusted working directory** (required).  
3. Optionally attach skills or experts.  
4. Submit your natural-language instructions.

Paths outside the working directory are generally rejected—do not select sensitive system directories as the workspace root.

## Skills

- Choose from built-in or installed skills when creating tasks or in Settings.  
- Files live under `~/.squid/skills/` (directory or single-file layouts per loader).  
- Tencent SkillHub installs and metadata paths: [tencent-skillhub.md](./tencent-skillhub.md).

## Experts

Built-in personas tune tone and domain boundaries; manage them in the expert center. Custom expert support depends on the current release.

## Scheduled jobs

1. Open the **Scheduled jobs** page.  
2. Create an entry: Cron expression, payload handed to the model, and other options.  
3. Jobs only fire while the **app is running**; quitting pauses scheduling.

Templates (daily digests, repo sweeps, etc.) appear in the wizard when available.

## Channels

- **WebUI**: primary chat/tasks UI, wired to the engine through the built-in channel.  
- **Extensions**: Feishu, Telegram, WeChat personal, etc., under `extensions/` and `~/.squid/extensions/` with `channel-plugin.json` manifests; enablement and forms are documented in [channel-extensions.md](./channel-extensions.md).

Feishu requires an Open Platform app, event subscription (WebSocket long connection or webhook), and local files such as `~/.squid/feishu-channel.json`. Webhook mode needs a URL reachable from Feishu—see [QUICK_START.md](./QUICK_START.md) and `extensions/feishu` README notes.

## Memory

Long-term memory can be inspected and edited in its dedicated UI; on-disk layout under `~/.squid` follows the implementation. Tests may override directories via environment variables (see developer docs).

## Claw and local HTTP APIs (advanced)

- The desktop shell exposes a **local HTTP API** for task execution and streaming—do not forward it to the public internet without hardening.  
- Additional Claw HTTP services live under `src/claw`; whether they start with the default desktop flow is controlled in `src/bun/index.ts`. Tokens and routing follow code and tests.

## Data and backups

| Path | Contents |
|------|----------|
| `~/.squid/config.json` | Primary settings and model keys |
| `~/.squid/skills/` | Installed skills |
| `~/.squid/channel-extensions.json` | User channel extension toggles |
| `~/.squid/extensions/` | Additional user extension root |

Back up the entire `~/.squid` directory regularly; never commit secrets.

## FAQ

**How do I change the default model?**  
Use Settings or override per task creation.

**Can tools read outside the workspace?**  
Not by default—sandbox and permission rules apply.

**Uninstall or migrate?**  
Quit the app, then back up or delete `~/.squid`. On a new machine restore that directory and reinstall the app binary.

## Related docs

- [QUICK_START.md](./QUICK_START.md) — shortest path to productivity  
- [developer-guide.md](./developer-guide.md) — internals and extensions  
- [tool-development-guide.md](./tool-development-guide.md) — tool contracts  
- [TEST_REPORT.md](./TEST_REPORT.md) — automated test summary  
