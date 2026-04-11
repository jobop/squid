# Compatibility: OpenClaw Feishu Plugin vs squid

This document corresponds to change `integrate-feishu-openclaw-channel` task 1; trace source paths from task 1.1.

## 1.1 Actual `openclaw/plugin-sdk/*` imports (`extensions/feishu`)

The following paths come from a static scan of `.ts` sources under `openclaw-main/extensions/feishu` for `from "openclaw/..."`:

| Module path |
|---------------|
| `openclaw/plugin-sdk/account-helpers` |
| `openclaw/plugin-sdk/account-id` |
| `openclaw/plugin-sdk/account-resolution` |
| `openclaw/plugin-sdk/allow-from` |
| `openclaw/plugin-sdk/channel-actions` |
| `openclaw/plugin-sdk/channel-config-helpers` |
| `openclaw/plugin-sdk/channel-contract` |
| `openclaw/plugin-sdk/channel-pairing` |
| `openclaw/plugin-sdk/channel-policy` |
| `openclaw/plugin-sdk/channel-send-result` |
| `openclaw/plugin-sdk/config-runtime` |
| `openclaw/plugin-sdk/conversation-runtime` |
| `openclaw/plugin-sdk/core` |
| `openclaw/plugin-sdk/directory-runtime` |
| `openclaw/plugin-sdk/feishu` |
| `openclaw/plugin-sdk/lazy-runtime` |
| `openclaw/plugin-sdk/media-runtime` |
| `openclaw/plugin-sdk/outbound-runtime` |
| `openclaw/plugin-sdk/reply-payload` |
| `openclaw/plugin-sdk/routing` |
| `openclaw/plugin-sdk/runtime-store` |
| `openclaw/plugin-sdk/secret-input` |
| `openclaw/plugin-sdk/setup` |
| `openclaw/plugin-sdk/status-helpers` |
| `openclaw/plugin-sdk/text-runtime` |
| `openclaw/plugin-sdk/webhook-ingress` |
| `openclaw/plugin-sdk/zod` |

The root `package.json` publishes the package as `@openclaw/feishu` with a **peer** dependency on `openclaw >= 2026.3.27`; build and runtime assume a full OpenClaw host.

## 1.2 Cross-check with `docs/feishu-interfaces.md` P0 (squid side)

| P0 item | squid status |
|---------|--------------|
| Send messages (equivalent to `sendMessageFeishu`) | **Present**: `FeishuChannelPlugin` + Feishu Open Platform HTTP (`im/v1/messages`) |
| Receive messages (webhook) | **Present**: `POST /api/feishu/webhook` → verify/decrypt → `submitFeishuInboundToEventBridge` |
| Account config `appId` / `appSecret` | **Present**: `~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config` (redacted responses) |
| Health check (equivalent to `probeFeishu`) | **Partial**: validity inferred by fetching `tenant_access_token` |

## 1.3 Conclusions

- **Not drop-in via import**: the official plugin depends on large portions of `plugin-sdk` and the OpenClaw runtime, which does not match the Electrobun/Bun desktop process model; you need a shim or a rewritten protocol layer.
- **Adapter / thin wrapper is viable**: squid uses **direct Feishu Open Platform access + `ChannelPlugin` + adapter inbound API → `EventBridge`**, without embedding the OpenClaw Feishu plugin runtime.
- **Must implement separately on squid**: OpenClaw-only session binding, cards, directory, pairing wizards, and other P1/P2 surfaces; a future **compatibility shim** should forward the original inbound path to `submitFeishuInboundToEventBridge` (see `docs/openclaw-adapter.md`).

## 1.4 Optional PoC

No isolated-branch PoC was run that fully instantiates `@openclaw/feishu`; static analysis already establishes the symbol dependency surface (Section 1.1). If a PoC is required, run it in a dedicated worktree with the OpenClaw host and plugin SDK aligned, and capture stack traces.

## 6. `feishu-openclaw-compatibility` spec walkthrough (task 5.3)

- **Assessment documented**: Section 1.3 states “adapter or standalone implementation”; Section 1.1 lists OpenClaw symbol evidence (≥3 entries).
- **P0 gaps**: Section 1.2 shows P0 covered by built-in direct integration or equivalent; gaps are mostly OpenClaw-specific session/card features (P1/P2).
- **Direct plugin reuse**: Section 1.3 downgrades to a standalone integration path; we do **not** claim the official plugin package loads as-is.
- **Shim vs adapter**: current code is a **thin protocol wrapper** (not a shim); task 4.6 is **N/A**; future shims must forward to `submitFeishuInboundToEventBridge` (see `docs/openclaw-adapter.md`).
