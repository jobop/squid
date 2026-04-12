---
name: find-skill-for-squid
description: Discover and install skills for squid using local skillhub CLI with deterministic path selection. Use when users ask to find/install skills or extend capabilities.
---

# Find Skills

Install/search skills into `~/.squid/skills`.

## Deterministic CLI Path Policy (MUST FOLLOW)

Before any `search/install/list`, determine one runnable CLI path and reuse it for the whole session.

Priority order:

1. `"$HOME/.local/bin/skillhub"`
2. `"$HOME/.skillhub/skillhub"`
3. `skillhub` (ONLY if `command -v skillhub` is confirmed)

Probe command:

```bash
if [ -x "$HOME/.local/bin/skillhub" ]; then
  SKILLHUB_BIN="$HOME/.local/bin/skillhub";
elif [ -x "$HOME/.skillhub/skillhub" ]; then
  SKILLHUB_BIN="$HOME/.skillhub/skillhub";
elif command -v skillhub >/dev/null 2>&1; then
  SKILLHUB_BIN="skillhub";
else
  echo "SKILLHUB_NOT_FOUND";
fi
```

If probe returns `SKILLHUB_NOT_FOUND`, call `skillhub_install` first, then re-probe.

Rules:

- Do not run bare `skillhub ...` unless probe confirms PATH availability.
- Once `SKILLHUB_BIN` is chosen, reuse it for all subsequent calls in this task.
- Do not claim success before a successful tool result.

## Workflow

1. Understand user intent and extract concise query terms.
2. Probe and lock `SKILLHUB_BIN`.
3. Search candidates with skillhub.
4. Present top matches with `slug`, short description, and install command.
5. On user confirmation, install by slug.
6. Verify installation with list (same `SKILLHUB_BIN`).

## Search Command

```bash
"$SKILLHUB_BIN" --dir "$HOME/.squid/skills" search "<query>" --search-limit 20 --json
```

## Install Command

Always install into squid skill directory:

```bash
"$SKILLHUB_BIN" --dir "$HOME/.squid/skills" install "<slug>" --force
```

## List Installed Skills

```bash
"$SKILLHUB_BIN" --dir "$HOME/.squid/skills" list
```

## Notes

- Do not use `npx skills ...` in squid workflow.
- Do not install to other directories unless the user explicitly asks.
- If no results are found, clearly tell the user and offer manual help.
- If install/search fails, report exact error and next retry action.

