import path from 'path';
import type { TaskMode } from './types';
import type { ToolRegistry } from '../tools/registry';
import type { Tool } from '../tools/base';

/** Plan 下始终可用的只读类工具 */
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

/** 仅允许指向 canonical 计划文件路径时执行 */
export const PLAN_MODE_PLAN_WRITE_TOOL_NAMES = new Set<string>(['file_edit', 'write_file']);

/** 规划期可调用子代理（子执行继承 plan，仍受白名单约束） */
export const PLAN_MODE_SUBAGENT_TOOL_NAMES = new Set<string>(['agent']);

/** 下发给模型的 Plan 工具并集 */
export const PLAN_MODE_ALLOWED_TOOL_NAMES = new Set<string>([
  ...PLAN_MODE_READONLY_TOOL_NAMES,
  ...PLAN_MODE_PLAN_WRITE_TOOL_NAMES,
  ...PLAN_MODE_SUBAGENT_TOOL_NAMES,
]);

/** 各 mode 共用的 system 段落：主模型自行判断是否同轮发起多工具；宿主按各工具 isConcurrencySafe 与批内写路径规则分批并发。 */
export function getParallelToolBatchSystemSection(): string {
  return `

# 同轮工具并行（由你判断）

- **是否并行由你根据任务决定**：若多步**相互独立**（无先后依赖、不写同一文件、不争抢同一关键资源），可在**同一条助手回复**里发起**多个**工具调用。
- **宿主如何执行**：对同轮调用按顺序扫描，**连续**且各工具在**当前参数**下声明为可并发的段会 \`Promise.all\`；遇到不可并发工具则该段顺序执行。多个 \`write_file\`/\`file_edit\` 仅在**目标路径解析后互不相同且均在工作区内**时才会同批并发；\`bash\` 等同轮默认顺序执行。
- **多个 \`agent\` 特别注意**：若各子任务的 \`instruction\` 都会 **写入同一 \`file_path\`**（例如都往 \`hello.all\` 里写），**不要同轮并发多个 \`agent\`**——子代理会并行执行，后写入覆盖先写入。应 **分轮** 逐个 \`agent\`，或 **只发一个 \`agent\`** / 由你在主会话里 **read 合并后一次 \`write_file\`**。
- **应分轮或合并为单次**：存在依赖、会改同一路径、或必须严格次序时，请分轮顺序调用或改用单次 \`agent\` 统筹。
- **示例**：多个互不相关的只读查询可同轮发起；多个不同路径的写入在路径不冲突时可同轮并发。`;
}

export function sanitizeConversationIdForFilename(id: string): string {
  const s = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
  return s || 'default';
}

/**
 * 当前会话在工作区内的 canonical 计划文件绝对路径。
 * 有 conversationId 时用 `.squid/plan-<sanitized>.md`，否则 `.squid/plan.md`。
 */
export function getCanonicalPlanFilePath(workspace: string, conversationId?: string): string {
  const root = path.resolve(workspace);
  const rel =
    conversationId?.trim().length ?? 0
      ? path.join('.squid', `plan-${sanitizeConversationIdForFilename(conversationId!)}.md`)
      : path.join('.squid', 'plan.md');
  return path.resolve(root, rel);
}

/** 传给 write_file / file_edit 的 file_path 应与该相对路径一致（相对当前工作区） */
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

/** 解析用户传入的 file_path（相对 workspace），与工具内 join(workDir, file_path) 一致 */
export function resolveToolFilePath(workspace: string, filePath: string): string {
  return path.resolve(workspace, filePath);
}

/** 目标路径必须在 workspace 根之下（防 .. 逃出） */
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

# Plan 模式（当前任务）

你处于 **规划阶段**（对齐「先探索、再成文」）。建议流程：

## 探索阶段

- 上文 system 已说明 **「同轮工具并行」** 的自行判断准则；若适合，可在**同一条回复**中发起多只读或多 \`agent\`（各 \`instruction\` 聚焦不同目录或问题）。子 \`agent\` 仍继承 **Plan** 约束，**不能**改业务文件或跑 Shell。
- 并发调用全部返回后，在下一轮**汇总**子结果，避免重复劳动。

## 成文阶段

- **必须**通过 \`write_file\`（新建）或 \`file_edit\`（已有内容时）把**本轮结论与可执行计划**写入下方**唯一**计划文件。
- **禁止**在尚未把本轮方案写入计划文件之前，对**其它任意路径**调用 \`write_file\` 或 \`file_edit\`。

**唯一允许的写入目标** — 工具参数 \`file_path\` 须为相对工作区的路径:
\`${planRel}\`

**同一文件的绝对路径（便于对照）:** \`${planPath}\`

计划正文请用 Markdown：步骤、拟创建/修改路径、风险、验证方式、（若曾并行探索）各子任务的要点摘要。

**禁止** Shell/PowerShell、定时任务创建/删除、\`skill\`、长期记忆写入等。

需要实际改业务代码或执行命令时，请让用户切换 **Ask** 或 **Craft**。`;
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
        `[Plan 模式] 不允许调用工具「${toolName}」。` +
        '请使用只读工具或仅写入计划文件；改业务代码请切换 Ask/Craft。',
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
        message: '[Plan 模式] write_file / file_edit 必须提供有效的 file_path。',
      };
    }
    const canonical = getCanonicalPlanFilePath(workspace, conversationId);
    const resolved = resolveToolFilePath(workspace, fp);
    if (!isPathInsideWorkspace(workspace, resolved)) {
      return {
        ok: false,
        message: `[Plan 模式] 路径越出工作区，已拒绝：${fp}`,
      };
    }
    if (!pathsEqualResolved(resolved, canonical)) {
      const allowedRel = getCanonicalPlanFileRelativePath(workspace, conversationId);
      return {
        ok: false,
        message:
          `[Plan 模式] 仅允许写入计划文件。\n允许路径（请使用与此一致的相对路径）: ` +
          `${allowedRel}\n` +
          `绝对路径: ${canonical}\n\n` +
          '下一步：请立即使用 write_file（或文件已存在时用 file_edit），将 file_path 设为上述「允许路径」中的相对路径，写入或更新 Markdown 计划（步骤、拟创建文件、验证方式）。' +
          '实际创建业务源码等请让用户切换 Ask 或 Craft。',
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    message: `[Plan 模式] 工具「${toolName}」未配置为可用。`,
  };
}

/** @deprecated 使用 checkPlanModeToolInvocation */
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
    `[Plan 模式] 当前任务处于规划阶段，不允许调用工具「${toolName}」。` +
    '请使用只读工具或仅写入计划文件；需要改业务代码时，请让用户将模式切换为 Ask 或 Craft。'
  );
}
