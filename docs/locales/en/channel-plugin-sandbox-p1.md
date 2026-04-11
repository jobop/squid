# Channel extensions: P1 sandbox direction (sketch, not implemented)

P0 today is **trusted paths + manifest validation + per-plugin failure isolation**; extension code shares the main process address space. The following options are future directions for review and scheduling.

## Goals

Keep `ChannelPlugin` **semantics stable** while moving untrusted or high-risk inbound/outbound work out of the main process to reduce blast radius.

## Option A: child-process adapter

- Main process keeps a thin **RPC client**; extension logic runs in a Node/Bun **child process** with JSON over `stdio` or a local socket.
- `ChannelPlugin.outbound.sendText` and similar calls serialize to RPC on the main side; the child invokes the real SDK.
- **Pros**: OS-level isolation; CPU/memory limits (platform-dependent).  
- **Cons**: latency, deployment complexity, lifecycle sync with desktop shutdown.

## Option B: worker threads

- Offload pure computation or network-free checks to `worker_threads` (where Bun support allows).
- **Limitation**: many IM SDKs assume the main thread or native addons—often still need a child process.

## Option C: V8 isolate / `isolated-vm`-style

- Lightweight isolation inside one process; evaluate **Bun compatibility** and Node API availability.
- Fits **highly constrained** script extensions, not hosting large official SDKs wholesale.

## RPC sketch

```text
Main process                    Extension child
  |  spawn(channel-plugin.json)    |
  |----------------init----------->|
  |<-------------ready--------------|
  |  outbound.sendText(payload) --> |
  |<------------- result ----------|
```

Envelopes can carry `correlationId`, `channelId`, `method`, `payload`; errors return `code` + `message` (redacted).

## Future acceptance ideas

- Child crash must not take down the host; host shutdown sends SIGTERM with timed SIGKILL fallback.  
- Per-extension RPC timeouts and quotas (payload size, QPS) should be configurable.

Current milestones still follow P0 documentation and configuration; implement this page only after a dedicated OpenSpec / design review.
