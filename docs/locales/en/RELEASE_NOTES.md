# squid v0.1.0 Release Notes

## Recent updates (2026-04-10)

### Channel image recognition path

- Telegram / Feishu / WeChat personal inbound images share one path: download into the workspace + `mentions(file)`.
- Busy-queue paths keep the same `mentions` so images are not dropped when requests enqueue.
- New shared persistence helper for extensions: `extensions/shared/workspace-image-store.ts`.

### Channel interrupt command `/wtf`

- Added `/wtf` to `TaskAPI.executeTaskStream`, matching Web ESC semantics: interrupt only the in-flight task for the current session; the queue is not cleared.
- The `/wtf` branch runs before the session busy gate so interrupts work even when the session is busy.
- Telegram / Feishu / WeChat bridge tests cover `/wtf` reaching the unified command branch.

## Overview

First public-facing squid release: an Electrobun-based local AI desktop workbench with multi-model chat, task modes, skills and experts, scheduled jobs, and optional channels (Feishu / Telegram / WeChat, enable as needed).

## Core capabilities

### Tasks and workspace

- Task modes: Ask (read-biased), Craft (automated tools), Plan (planning and confirmation)
- Task state machine and persistence
- Working directory binding and path sandboxing

### Models

- Anthropic Claude family (per Settings)
- OpenAI-compatible endpoints
- DeepSeek and other compatible hosts (depends on current adapters and Settings)
- Streaming output and token accounting (as implemented)
- Local encrypted storage for API keys

### Skills and experts

- Multiple built-in skill templates; load from `~/.squid/skills` and install from SkillHub and other sources
- Built-in expert roles and extension points

### Channels

- Built-in WebUI channel
- Extensions under `extensions/` and `~/.squid/extensions`, declarative configuration, TaskAPI bridge

### Claw and automation

- Claw-related HTTP surface and token design live under `src/claw`; whether the default desktop entry enables Claw services follows `src/bun/index.ts`
- Scheduled jobs on node-cron with execution history

### Desktop shell

- Electrobun: Bun main process + system WebView
- Main layout, Settings, task and session UI

## Tests

Latest recorded automated run: 9 test files, 31 cases passing (see [TEST_REPORT.md](./TEST_REPORT.md)). Run `npm test` on your target machine before release.

## Install and commands (source)

```bash
git clone <repository-url>
cd squid
npm install
npm test          # optional
npm run dev       # desktop development
npm run build     # tsc
npm run build:electron:release   # stable desktop artifacts (outputs to artifacts/)
```

## Configuration

First run: enter model keys in **Settings** and save. Channels and Feishu: see [QUICK_START.md](./QUICK_START.md) and [channel-extensions.md](./channel-extensions.md).

**Build note**: Electrobun **only reads `electrobun.config.ts`**; missing file or a `.js` config means the stable package may omit `public`, producing a blank UI.

## Documentation index

- [user-guide.md](./user-guide.md)
- [developer-guide.md](./developer-guide.md)
- [TEST_REPORT.md](./TEST_REPORT.md)
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

## Security

- Workspace path validation and tool permission tiers
- Local encrypted key storage
- Local HTTP services should not be exposed to the public internet by default

## Known limitations

- Some UI and selectors are still evolving (track via issues and milestones)
- Unsigned / un-notarized macOS public builds may trigger Gatekeeper; prefer Developer ID signing and notarization for distribution

## Roadmap (planning)

- Richer skills and channel ecosystem, Settings, and observability
- Performance and UX polish

## License

MIT License

---

**Release date**: 2026-04-04 (updated with repository maintenance)  
**Version**: v0.1.0  
**Status**: maintained
