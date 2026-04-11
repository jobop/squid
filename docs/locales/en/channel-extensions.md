# Channel extension plugins (dynamic loading)

## P0 trust model (required reading)

Extensions load via Bun **dynamic `import()`** in the **same process** as the main app—this is **not** an in-memory sandbox. **Only install and configure extensions you trust** (verifiable source). With no configured `roots`, nothing loads; **Feishu** ships under `extensions/feishu/` and is typically enabled via `enabled: ["feishu"]` in `config/channel-extensions.json` (the Channels page shows source **Extension**).

Priority and conflicts:

- **Built-in** is WebUI only; Feishu and other extensions register through the loader. Extensions **must not override** an already registered `id` (built-in `webui` registers first); conflicts are skipped and recorded in `errors` on `GET /api/channels`.
- If two extension packages declare the same `id`, **the first successful registration wins**; the later one is skipped.

## Package layout

Each plugin is a subdirectory; the parent path is listed in `roots`:

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # or .js; path from `main`
```

### channel-plugin.json

| Field | Description |
|-------|-------------|
| `id` | Unique id; must match `ChannelPlugin.id` from the factory |
| `name` | Display name |
| `version` | Version string |
| `main` | ESM entry relative to the plugin directory; must not be absolute or contain `..` |
| `capabilities` / `permissions` | Optional, reserved |

### Entry module

Must **default export** or named export **`createChannelPlugin`**: a factory returning `ChannelPlugin` or `Promise<ChannelPlugin>`.

See `src/channels/types.ts` (`config`, `outbound`, `status` required; `setup` recommended for long-lived connections).

## Configuration

Merged from both (when present, `roots` arrays merge; `enabled` prefers **`~/.squid/channel-extensions.json`**):

1. `squid/config/channel-extensions.json` (create from `config/channel-extensions.example.json`)
2. `~/.squid/channel-extensions.json`

Fields:

- **`roots`**: `string[]`, each entry a parent directory that **contains multiple plugin subdirectories**. May be absolute or relative to the **squid repository root**.
- **`enabled`** (optional): omit or `null` to attempt all validated candidates; `[]` loads none; non-empty arrays **only** load listed `id`s.

### User directory `~/.squid/extensions` (no `roots` entry required)

If **`~/.squid/extensions`** exists, it is **automatically** merged as an extra scan root (missing directory is ignored without error). Place personal plugins such as `~/.squid/extensions/my-plugin/channel-plugin.json`. Loading still obeys the **`enabled`** whitelist (for example, add your custom plugin `id` to `~/.squid/channel-extensions.json` or project config when defaults only include `feishu`).

Restart the host after changing configuration.

## Example

The repository ships `extensions/example-echo-channel/`. Put this in `config/channel-extensions.json`:

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

After restart, the Channels sidebar should list `echo-demo` with source **Extension**.

## API

- `GET /api/channels` returns `{ "channels": [...], "errors": [...] }`. Each channel includes `source`: `"builtin"` | `"extension"`. `errors` lists non-fatal scan/load issues (no secrets).

## Local debugging

1. Create a subdirectory under `roots` with `channel-plugin.json`.  
2. When the entry is TypeScript, ensure **Bun** loads it (desktop backend is Bun).  
3. Watch `[ChannelExtensions]` logs and the orange banner in the UI.

## Busy-session queueing and replies (no extra `QueuedCommand` fields)

To mirror Feishu / Telegram—**enqueue when busy, then post the assistant reply back to the same chat** for a new channel:

1. In the extension’s **`setup.initialize`**, if the factory context provides **`ctx.taskAPI`** (injected when the host calls `initializeBuiltinChannels(taskAPI)`), call your **`registerXxxSquidBridge(ctx.taskAPI)`** (or equivalent). Inside the bridge, use **`taskAPI.addChannelQueuedCompleteHandler(...)`** and only send when `cmd.channelReply?.channelId === '<your channel id>'`. In **`setup.cleanup`**, call the bridge’s unload hook. **The host does not** import `registerXxxSquidBridge` per channel.
2. When the session is busy, call **`enqueueFromRequest(..., { channelReply: { channelId: '<same>', chatId: '<routing key>' } })`**. `chatId` is an opaque string whose meaning is channel-specific.

Types live in `src/utils/messageQueueManager.ts` as **`ChannelQueueReply`**. Do not add more `xxxChatId` fields to core.

## Relationship to built-in contributions

- **Built-in**: still land implementations under `src/channels` and register in `initializeBuiltinChannels` via PR.  
- **Extensions**: better for private or experimental channels without touching the core registry; security is the operator’s responsibility (configuration and source).
