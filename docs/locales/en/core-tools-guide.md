# Core tools guide

This guide covers ten core tools added to squid: usage and constraints.

## 1. FileEditTool (`file_edit`)

**Purpose**: precise file edits via string match and replace.

**Inputs**:

- `file_path` (string): target file
- `old_string` (string): text to find
- `new_string` (string): replacement text
- `replace_all` (boolean, optional): replace every match (default `false`)

**Example**:

```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**Limits**:

- Multiple matches without `replace_all=true` return an error
- Literal string matching only—no regular expressions

---

## 2. BashTool (`bash`)

**Purpose**: run Bash commands with optional timeout and background mode.

**Inputs**:

- `command` (string): shell command
- `working_directory` (string, optional)
- `timeout` (number, optional): milliseconds, default `30000`
- `run_in_background` (boolean, optional)

**Example**:

```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**Limits**:

- No interactive TTY sessions
- Background jobs are not persisted across restarts
- Marked destructive—requires explicit user trust

---

## 3. PowerShellTool (`powershell`)

**Purpose**: run PowerShell commands (**Windows only**).

**Inputs**:

- `command` (string)
- `working_directory` (string, optional)
- `timeout` (number, optional), default `30000`
- `run_in_background` (boolean, optional)

**Example**:

```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**Limits**:

- Windows-only; errors on other platforms

---

## 4. WebSearchTool (`web_search`)

**Purpose**: search the web via DuckDuckGo HTML results.

**Inputs**:

- `query` (string)
- `max_results` (number, optional): default `10`, hard cap `10`

**Example**:

```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**Limits**:

- Depends on DuckDuckGo HTML layout—may break if the site changes
- No API key required; quality may trail paid search APIs
- At most 10 results

---

## 5. Cron tool family

### 5.1 CronCreateTool (`cron_create`)

**Purpose**: create a scheduled job.

**Inputs**:

- `cron_expression` (string): standard cron (e.g. `"0 * * * *"` hourly)
- `task_content` (string): description handed to the model

**Example**:

```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "Every day at 9:00, run the backup checklist"
}
```

### 5.2 CronDeleteTool (`cron_delete`)

**Purpose**: delete a job by id.

**Inputs**:

- `task_id` (string)

### 5.3 CronListTool (`cron_list`)

**Purpose**: list all jobs.

**Inputs**: none

**Limits**:

- In-memory storage in current builds—jobs are lost on restart
- Persistence may arrive in a future release

---

## 6. SkillTool (`skill`)

**Purpose**: invoke registered skills (task templates).

**Inputs**:

- `skill_name` (string)
- `args` (string, optional)

**Example**:

```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**Limits**:

- Only skills marked `user-invocable: true`
- Skill files live under `~/.squid/skills/`
- Execution depends on model configuration (`~/.squid/config.json`)
- Runs through the unified executor and may trigger further tools

---

## 7. BriefTool (`brief`)

**Purpose**: summarize content with selectable styles.

**Inputs**:

- `content` (string)
- `prompt` (string, optional)
- `type` (enum, optional): `brief`, `detailed`, `bullet_points`

**Example**:

```typescript
{
  content: "Long article text...",
  type: "bullet_points"
}
```

**Limits**:

- Expects `ANTHROPIC_API_KEY` in the environment (per current implementation)
- Content over 50,000 characters is truncated
- Calls a remote API—may incur cost

---

## 8. AgentTool (`agent`)

**Purpose**: spawn a child agent with its own context window.

**Inputs**:

- `instruction` (string)
- `timeout` (number, optional): default `300000` (5 minutes)

**Example**:

```typescript
{
  instruction: "Scan all TypeScript files in the project for likely performance issues",
  timeout: 600000
}
```

**Limits**:

- Depends on model configuration (`~/.squid/config.json`)
- Default timeout five minutes unless overridden
- Returns structured metadata (executor, mode, workspace, duration)

---

## Tool metadata

Each tool exposes:

- **`isConcurrencySafe`**: safe to parallelize with other calls
- **`isReadOnly`**: read-only side effects
- **`isDestructive`**: may mutate system or workspace state

## Result persistence

All tools implement `mapToolResultToToolResultBlockParam`:

- When output exceeds `maxResultSizeChars`, it is written to disk automatically
- A short preview is returned to protect context size

## Safety notes

1. **BashTool / PowerShellTool**: arbitrary command execution—use with care  
2. **FileEditTool**: mutates files—prefer version control  
3. **BriefTool / AgentTool**: outbound API calls—protect keys  
4. **WebSearchTool**: scraped HTML may be hostile—sanitize before reuse  

## Tests

Each tool ships with unit tests (happy path, edge cases, errors, interface compliance).

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
