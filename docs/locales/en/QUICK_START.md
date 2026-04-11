# squid Quick Start

For end users: install and run squid locally, configure a model, then start chatting and running tasks. Architecture and extensions are covered in [developer-guide.md](./developer-guide.md).

## Product positioning

squid is a **locally run AI desktop workbench** for:

- Reading, reviewing, and light edits under a chosen working directory (subject to task mode and sandbox rules)
- Combining skills and expert presets for documentation, retrieval, and structured output
- Running scheduled jobs on Cron triggers on this machine
- Optional **channel extensions** such as Feishu, Telegram, or WeChat (separate configuration—see [channel-extensions.md](./channel-extensions.md))

## Environment and launch

**From source (recommended for developers)**

- Node.js 22 LTS and npm; the desktop shell uses Electrobun (the CLI is prepared per platform when you run `npm run dev`).
- The project root must contain **`electrobun.config.ts`** (Electrobun only reads this filename).

```bash
cd squid
npm install
npm run dev
```

**Release builds**

If you install from GitHub Release or similar, follow the platform-specific instructions. Unsigned / un-notarized macOS builds may require Control-click **Open** or system prompts; see the repository [README.md](./README.md).

## Configure API keys

Configure at least one model provider in **Settings** (keys are written to `~/.squid/config.json` on this machine):

| Provider | Notes |
|----------|--------|
| Anthropic | Create an API key in the [Anthropic Console](https://console.anthropic.com/) |
| OpenAI | Create an API key on the [OpenAI Platform](https://platform.openai.com/) |
| Compatible endpoints | Custom base URL and model name in Settings (must match the protocol the app expects) |

## First-time flow

1. After launch, open **Settings** in the sidebar and save model-related options.  
2. In chat or tasks, **pick a working directory** (do not use an untrusted path as the workspace root).  
3. **Create a new session or task** and pick a mode:  
   - **Ask**: read-only analysis by default; avoids rewriting files (verify against the current build).  
   - **Craft**: allows automated tool execution; may modify files inside the workspace.  
   - **Plan**: planning and stepwise guidance for complex work.  
4. Optionally pick **skills** or **experts**.

## Channels and Feishu (optional)

- The **Channels** sidebar lists built-in WebUI and extension channel status.  
- The Feishu implementation lives under `extensions/feishu/`; whether it is enabled in `config/channel-extensions.json` depends on the repository. User-side enablement can go in `~/.squid/channel-extensions.json`.  
- Personal or third-party extensions can live under `~/.squid/extensions/<dir>/`; see [channel-extensions.md](./channel-extensions.md).

Bot creation, long connection vs webhook, and `~/.squid/feishu-channel.json` field meanings follow in-app copy and [user-guide.md](./user-guide.md).

## Example tasks

**Code review (Ask)**

```text
Mode: Ask
Working directory: <your project path>
Prompt: Summarize responsibilities of major modules under src/ and list readability issues and obvious defects.
```

**Batch documentation (Craft)**

```text
Mode: Craft
Working directory: <project path>
Prompt: Draft Markdown API notes for public APIs in the given directory.
```

**Scheduled jobs**

Create entries on the **Scheduled jobs** page with a Cron expression and the content to hand to the model; scheduling does not run while the app is closed.

## Skills and experts

- **Skills**: pick installed skills in the UI; files live under `~/.squid/skills/` (including SkillHub installs).  
- **Experts**: adjust system role and boundaries; manage built-in and custom entries on the expert-related pages.

## FAQ

**Are keys only on this machine?**  
Yes. Do not commit configuration or secrets to Git; back up `~/.squid` yourself.

**Will tasks modify files?**  
Depends on mode and tool policy: Ask is read-biased; Craft may write; Plan usually explains before acting. Follow on-screen guidance.

**Working directory boundaries?**  
File tools are generally scoped to the session’s bound working directory; see permission and sandbox code for exact checks.

**How do I stop a running task?**  
Use the stop/interrupt control in the task or session UI (wording may vary).

**Do scheduled jobs run after I quit?**  
No; scheduling requires a running app process.

## Further reading

| Doc | Contents |
|-----|----------|
| [user-guide.md](./user-guide.md) | Features and UI |
| [developer-guide.md](./developer-guide.md) | Layout and extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Built-in tool conventions |
| [TEST_REPORT.md](./TEST_REPORT.md) | Automated tests overview |

Please file issues or pull requests on the repository tracker.
