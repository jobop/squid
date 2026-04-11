---
name: find-skills
description: Discover and install skills for squid using the local skillhub CLI. Use when users ask to find/install skills or extend capabilities.
---

# Find Skills

Use this skill to discover and install skills into squid (`~/.squid/skills`).

## Required CLI Path Policy

Prefer absolute binary path first to avoid PATH issues in desktop startup environments:

```bash
"$HOME/.local/bin/skillhub" --dir "$HOME/.squid/skills" search "<query>" --search-limit 20 --json
```

If absolute path is unavailable, fallback to:

```bash
skillhub --dir "$HOME/.squid/skills" search "<query>" --search-limit 20 --json
```

## Workflow

1. Understand user intent and extract concise query terms.
2. Search candidates with skillhub.
3. Present top matches with `slug`, short description, and install command.
4. On user confirmation, install by slug.

## Install Command

Always install into squid skill directory:

```bash
"$HOME/.local/bin/skillhub" --dir "$HOME/.squid/skills" install "<slug>" --force
```

Fallback:

```bash
skillhub --dir "$HOME/.squid/skills" install "<slug>" --force
```

## List Installed Skills

```bash
"$HOME/.local/bin/skillhub" --dir "$HOME/.squid/skills" list
```

Fallback:

```bash
skillhub --dir "$HOME/.squid/skills" list
```

## Notes

- Do not use `npx skills ...` in squid workflow.
- Do not install to other directories unless the user explicitly asks.
- If no results are found, clearly tell the user and offer manual help.

