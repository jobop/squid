import path from 'path';
import type { ToolRegistry } from '../tools/registry';
import { isPathInsideWorkspace } from './plan-mode-policy';

/** 单次工具调用元数据（OpenAI / 流式 / Anthropic 统一） */
export type ToolCallPartitionItem = {
  toolName: string;
  rawArguments: string;
  /** OpenAI tool_call_id */
  toolCallId?: string;
  /** Anthropic tool_use_id */
  toolUseId?: string;
};

export type ToolExecutionBatch = {
  concurrent: boolean;
  items: ToolCallPartitionItem[];
};

function parseJsonArgs(raw: string): unknown | null {
  try {
    return JSON.parse(raw && raw.trim() ? raw : '{}');
  } catch {
    return null;
  }
}

/**
 * 单条调用是否被工具声明为可与其余调用并发（需配合 safeParse）。
 */
export function itemIsConcurrencySafe(
  registry: ToolRegistry,
  toolName: string,
  rawArguments: string
): boolean {
  const tool = registry.get(toolName);
  if (!tool) return false;
  const json = parseJsonArgs(rawArguments);
  if (json === null) return false;
  const parsed = tool.inputSchema.safeParse(json);
  if (!parsed.success) return false;
  try {
    return Boolean(tool.isConcurrencySafe(parsed.data));
  } catch {
    return false;
  }
}

/**
 * 将同轮 tool_calls 切成连续块：相邻且均为 isConcurrencySafe 的合并为一批（可 Promise.all）。
 */
export function partitionToolCalls(
  registry: ToolRegistry,
  items: ToolCallPartitionItem[]
): ToolExecutionBatch[] {
  return items.reduce<ToolExecutionBatch[]>((acc, item) => {
    const safe = itemIsConcurrencySafe(registry, item.toolName, item.rawArguments);
    const last = acc[acc.length - 1];
    if (safe && last?.concurrent) {
      last.items.push(item);
    } else {
      acc.push({ concurrent: safe, items: [item] });
    }
    return acc;
  }, []);
}

function resolvedFilePathFromArgs(
  root: string,
  workspace: string,
  rawArguments: string
): string | null {
  const json = parseJsonArgs(rawArguments);
  if (json === null || typeof json !== 'object' || json === null) return null;
  const fp = (json as Record<string, unknown>).file_path;
  if (typeof fp !== 'string' || !fp.trim()) return null;
  const abs = path.resolve(root, fp);
  if (!isPathInsideWorkspace(workspace, abs)) return null;
  return abs;
}

/**
 * 可并发批内：write_file / file_edit 的 file_path 解析后在 workspace 内、两两不同；
 * 且不得与同批 read_file 目标路径相同（避免读写竞态）。否则整批降级为串行。
 */
export function refineBatchesForDisjointWritePaths(
  batches: ToolExecutionBatch[],
  workspace: string
): void {
  const root = path.resolve(workspace);

  for (const batch of batches) {
    if (!batch.concurrent) continue;

    const writeItems = batch.items.filter(
      (i) => i.toolName === 'write_file' || i.toolName === 'file_edit'
    );
    if (writeItems.length === 0) continue;

    const resolvedWrites: string[] = [];
    let ok = true;

    for (const it of writeItems) {
      const abs = resolvedFilePathFromArgs(root, workspace, it.rawArguments);
      if (abs === null) {
        ok = false;
        break;
      }
      resolvedWrites.push(abs);
    }

    if (!ok) {
      batch.concurrent = false;
      continue;
    }

    if (new Set(resolvedWrites).size !== resolvedWrites.length) {
      batch.concurrent = false;
      continue;
    }

    const readItems = batch.items.filter((i) => i.toolName === 'read_file');
    for (const it of readItems) {
      const abs = resolvedFilePathFromArgs(root, workspace, it.rawArguments);
      if (abs === null) {
        batch.concurrent = false;
        break;
      }
      if (resolvedWrites.some((w) => w === abs)) {
        batch.concurrent = false;
        break;
      }
    }
  }
}

/**
 * 按批执行 run，保持 items 原有顺序与返回数组一一对应。
 */
export async function executePartitionedBatches<T>(
  batches: ToolExecutionBatch[],
  runOne: (item: ToolCallPartitionItem) => Promise<T>
): Promise<T[]> {
  const out: T[] = [];
  for (const batch of batches) {
    if (batch.concurrent) {
      const chunk = await Promise.all(batch.items.map((it) => runOne(it)));
      out.push(...chunk);
    } else {
      for (const it of batch.items) {
        out.push(await runOne(it));
      }
    }
  }
  return out;
}
