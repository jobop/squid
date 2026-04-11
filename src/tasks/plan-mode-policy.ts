import path from 'path';
import type { TaskMode } from './types';
import type { ToolRegistry } from '../tools/registry';
import type { Tool } from '../tools/base';

/** Read-only tools always available in Plan mode. */
export const PLAN_MODE_READONLY_TOOL_NAMES = new Set<string>([
  'read_file',
  'glob',
  'grep',
  'web_fetch',
  'web_search',
  'brief',
  'cron_list',
  'cron_status',
  'cron_runs',
]);

/** Writable tools are only allowed for the canonical plan file path. */
export const PLAN_MODE_PLAN_WRITE_TOOL_NAMES = new Set<string>(['file_edit', 'write_file']);

/** Subagent is allowed during planning and still follows plan-mode allowlist. */
export const PLAN_MODE_SUBAGENT_TOOL_NAMES = new Set<string>(['agent']);

/** Union set of tools exposed to the model in Plan mode. */
export const PLAN_MODE_ALLOWED_TOOL_NAMES = new Set<string>([
  ...PLAN_MODE_READONLY_TOOL_NAMES,
  ...PLAN_MODE_PLAN_WRITE_TOOL_NAMES,
  ...PLAN_MODE_SUBAGENT_TOOL_NAMES,
]);

/** Shared system section for all modes about multi-tool batching. */
export function getParallelToolBatchSystemSection(): string {
  return `

# Parallel Tool Calls in One Turn (model-decided)

- **Decide parallelism based on task dependency**: if steps are independent (no order dependency, no shared file writes, no shared critical resources), you may issue multiple tool calls in one assistant message.
- **How the host executes**: the host scans same-turn calls in order. Consecutive calls that are marked concurrency-safe under current arguments are grouped with \`Promise.all\`. Non-concurrency-safe calls run sequentially. Multiple \`write_file\`/\`file_edit\` calls are only parallelized when resolved target paths are distinct and inside workspace. \`bash\` calls are sequential by default.
- **Special caution for multiple \`agent\` calls**: if subtask instructions write to the same \`file_path\` (for example all writing \`hello.all\`), do not run multiple \`agent\` calls in parallel in one turn because later writes can overwrite earlier writes. Split across turns, use one \`agent\`, or merge in the main session and write once.
- **Use sequential turns when needed**: if dependencies exist, the same path is modified, or strict ordering is required, use sequential turns or one orchestrated \`agent\` call.
- **Examples**: independent read-only queries can run in one turn; writes to disjoint paths can run in parallel.`;
}

export function sanitizeConversationIdForFilename(id: string): string {
  const s = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
  return s || 'default';
}

/**
 * Returns the canonical absolute plan file path in workspace.
 * Uses `.squid/plan-<sanitized>.md` when conversationId exists,
 * otherwise `.squid/plan.md`.
 */
export function getCanonicalPlanFilePath(workspace: string, conversationId?: string): string {
  const root = path.resolve(workspace);
  const rel =
    conversationId?.trim().length ?? 0
      ? path.join('.squid', `plan-${sanitizeConversationIdForFilename(conversationId!)}.md`)
      : path.join('.squid', 'plan.md');
  return path.resolve(root, rel);
}

/** Relative path expected by write_file / file_edit in current workspace. */
export function getCanonicalPlanFileRelativePath(workspace: string, conversationId?: string): string {
  const canonical = getCanonicalPlanFilePath(workspace, conversationId);
  return path.relative(workspace, canonical) || '.';
}

function pathsEqualResolved(a: string, b: string): boolean {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

/** Resolves user-provided file_path exactly like tool-side resolution. */
export function resolveToolFilePath(workspace: string, filePath: string): string {
  return path.resolve(workspace, filePath);
}

/** Ensures target path stays inside workspace root. */
export function isPathInsideWorkspace(workspace: string, absoluteTarget: string): boolean {
  const root = path.resolve(workspace);
  const target = path.resolve(absoluteTarget);
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function getPlanModeSystemAppendix(workspace: string, conversationId?: string): string {
  const planPath = getCanonicalPlanFilePath(workspace, conversationId);
  const planRel = getCanonicalPlanFileRelativePath(workspace, conversationId);
  return `

# Plan Mode (current task)

You are in the planning phase (explore first, then write plan). Recommended flow:

## Exploration Phase

- The system section above defines same-turn parallel tool rules. When appropriate, run multiple read-only tools or multiple \`agent\` calls in one response (each instruction should target different directories/questions). Subagents still inherit Plan constraints and cannot modify business files or run shell commands.
- After all parallel calls return, summarize results in the next turn to avoid duplicate work.

## Plan Writing Phase

- You MUST write the conclusions and executable plan of this turn to the single plan file below via \`write_file\` (create) or \`file_edit\` (update).
- Before writing this plan file, DO NOT call \`write_file\` or \`file_edit\` on any other path.

**Only allowed write target** — tool parameter \`file_path\` must be this workspace-relative path:
\`${planRel}\`

**Absolute path of the same file (for reference):** \`${planPath}\`

Write the plan body in Markdown: steps, files to create/modify, risks, validation method, and (when explored in parallel) summary of each subtask.

Do NOT use Shell/PowerShell, cron create/delete, \`skill\`, long-term memory writes, or equivalent side-effect operations.

If business code changes or command execution are required, ask the user to switch to **Ask** or **Craft** mode.`;
}

export function getToolsForTaskMode(mode: TaskMode, registry: ToolRegistry): Tool[] {
  const all = registry.getAll();
  if (mode !== 'plan') {
    return all;
  }
  return all.filter((t) => PLAN_MODE_ALLOWED_TOOL_NAMES.has(t.name));
}

export type PlanModeInvocationResult =
  | { ok: true }
  | { ok: false; message: string };

export function checkPlanModeToolInvocation(
  toolName: string,
  args: Record<string, unknown>,
  workspace: string,
  conversationId?: string
): PlanModeInvocationResult {
  if (!PLAN_MODE_ALLOWED_TOOL_NAMES.has(toolName)) {
    return {
      ok: false,
      message:
        `[Plan mode] Tool "${toolName}" is not allowed. ` +
        'Use read-only tools or write only to the plan file. Switch to Ask/Craft for business code changes.',
    };
  }

  if (PLAN_MODE_READONLY_TOOL_NAMES.has(toolName)) {
    return { ok: true };
  }

  if (PLAN_MODE_SUBAGENT_TOOL_NAMES.has(toolName)) {
    return { ok: true };
  }

  if (PLAN_MODE_PLAN_WRITE_TOOL_NAMES.has(toolName)) {
    const fp = args.file_path;
    if (typeof fp !== 'string' || !fp.trim()) {
      return {
        ok: false,
        message: '[Plan mode] write_file / file_edit requires a valid file_path.',
      };
    }
    const canonical = getCanonicalPlanFilePath(workspace, conversationId);
    const resolved = resolveToolFilePath(workspace, fp);
    if (!isPathInsideWorkspace(workspace, resolved)) {
      return {
        ok: false,
        message: `[Plan mode] Path escapes workspace and is rejected: ${fp}`,
      };
    }
    if (!pathsEqualResolved(resolved, canonical)) {
      const allowedRel = getCanonicalPlanFileRelativePath(workspace, conversationId);
      return {
        ok: false,
        message:
          `[Plan mode] Only plan-file writes are allowed.\nAllowed path (use this exact workspace-relative path): ` +
          `${allowedRel}\n` +
          `Absolute path: ${canonical}\n\n` +
          'Next step: immediately call write_file (or file_edit if the file exists), set file_path to the allowed relative path above, and write/update the Markdown plan (steps, files to create, validation method). ' +
          'For real business code edits, ask the user to switch to Ask or Craft.',
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    message: `[Plan mode] Tool "${toolName}" is not configured as allowed.`,
  };
}

/** @deprecated Use checkPlanModeToolInvocation instead. */
export function isToolInvocationAllowedInPlanMode(
  toolName: string,
  args: Record<string, unknown>,
  workspace: string,
  conversationId?: string
): boolean {
  return checkPlanModeToolInvocation(toolName, args, workspace, conversationId).ok;
}

export function planModeToolRejectionMessage(toolName: string): string {
  return (
    `[Plan mode] Current task is in planning stage, tool "${toolName}" is not allowed. ` +
    'Use read-only tools or write only to the plan file. Ask the user to switch to Ask or Craft for business code edits.'
  );
}
