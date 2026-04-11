# squid Project Overview

This document summarizes repository capabilities and module boundaries for product and engineering review; when it diverges from code, trust the source.

## Positioning

squid: local-first AI desktop workbench (Electrobun + Bun + system WebView). Data defaults to `~/.squid` under the user profile.

## Implemented capabilities (summary)

### Tasks and context

- Task data model and Ask / Craft / Plan state machine  
- Context compression and task persistence  
- Permission tiers and tool risk classification  

### Models

- Anthropic, OpenAI, DeepSeek, and other adapters/registry (see `src/models`)  
- Streaming output, token accounting, encrypted key storage  

### Workspace and tools

- Working directory binding and path sandbox  
- ReadFile, WriteFile, Glob, Grep, and unified tool result mapping with size limits  

### Skills and experts

- Skill YAML, loader, allowlists, and hooks  
- Built-in skills and expert templates; some UI surfaces still evolving  

### Claw and scheduling

- Claw HTTP services and task handling (`src/claw`); whether the desktop entry enables them follows `src/bun/index.ts`  
- node-cron scheduled jobs, execution history, optional email-style notifications when configured  

### Channels

- Channel registry and built-in WebUI  
- Extensions under `extensions/` plus user directories, declarative manifests, TaskAPI bridge  
- EventBridge and WebSocket integration with the UI (see `docs/webui-channel.md`, etc.)  

### Desktop and front end

- React main UI, Settings, task and session pages  
- Local HTTP API (`Bun.serve` in the main process for UI calls)  

### Quality

- Vitest unit and integration-style cases (see [TEST_REPORT.md](./TEST_REPORT.md))  
- User and developer documentation under `docs/`  

## Testing and quality gates

Latest archived run: 9 test files, 31 cases passing (see TEST_REPORT). Run `npm test` locally before merging.

## Security (summary)

- Path sandbox and read-only / destructive tool flags  
- Local key protection with AES-256-GCM (see `secure-storage` implementation)  
- Claw tokens and permission engine when those paths are enabled  

## Performance (summary)

- LRU caches, virtual scrolling, lazy loading, streaming responses, context compression (per module)  

## Documentation

| Doc | Purpose |
|-----|---------|
| [QUICK_START.md](./QUICK_START.md) | Fast onboarding |
| [user-guide.md](./user-guide.md) | Feature tour |
| [developer-guide.md](./developer-guide.md) | Architecture and extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Tool authoring conventions |
| [TEST_REPORT.md](./TEST_REPORT.md) | Test report |

## Version status

The canonical version is `package.json`; release notes live in [RELEASE_NOTES.md](./RELEASE_NOTES.md).
