import { TaskExecutor } from '../tasks/executor';
import type { TaskMode } from '../tasks/types';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from './registry';
import { saveMemoryTool } from './save-memory';
import { ReadFileTool } from './read-file';
import { WriteFileTool } from './write-file';
import { GlobTool } from './glob';
import { GrepTool } from './grep';
import { WebFetchTool } from './web-fetch';
import { FileEditTool } from './file-edit';
import { BashTool } from './bash';
import { PowerShellTool } from './powershell';
import { WebSearchTool } from './web-search';
import { CronCreateTool } from './cron-create';
import { CronDeleteTool } from './cron-delete';
import { CronListTool } from './cron-list';
import { BriefTool } from './brief';
import { SkillTool } from './skill';

export type UnifiedExecutionErrorType = 'timeout' | 'config' | 'execution';

export interface UnifiedExecutionMetadata {
  executor: 'TaskExecutor';
  mode: TaskMode;
  workspace: string;
  timeoutMs: number;
}

export interface UnifiedExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  errorType?: UnifiedExecutionErrorType;
  duration: number;
  metadata: UnifiedExecutionMetadata;
}

const DEFAULT_TIMEOUT_MS = 300000;

/**
 * 子代理（agent / skill 内嵌执行）使用的工具集。
 * 与 TaskAPI 主会话对齐核心能力（含 skill）；不含嵌套 `agent` 以免深度与成本失控（需要时可再开放）。
 */
function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(saveMemoryTool);
  registry.register(ReadFileTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  registry.register(WebFetchTool);
  registry.register(FileEditTool);
  registry.register(WriteFileTool);
  registry.register(BashTool);
  registry.register(PowerShellTool);
  registry.register(WebSearchTool);
  registry.register(CronCreateTool);
  registry.register(CronDeleteTool);
  registry.register(CronListTool);
  registry.register(SkillTool);
  registry.register(BriefTool);
  return registry;
}

function getErrorType(errorMessage: string): UnifiedExecutionErrorType {
  if (
    errorMessage.includes('请先在设置页面配置 API Key') ||
    errorMessage.includes('未知的 API 提供商') ||
    errorMessage.includes('API key not configured')
  ) {
    return 'config';
  }
  return 'execution';
}

export async function executeWithUnifiedStack(params: {
  instruction: string;
  workspace: string;
  mode: TaskMode;
  timeoutMs?: number;
}): Promise<UnifiedExecutionResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const metadata: UnifiedExecutionMetadata = {
    executor: 'TaskExecutor',
    mode: params.mode,
    workspace: params.workspace,
    timeoutMs,
  };

  const executor = new TaskExecutor(new SkillLoader(), createRegistry());

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`子任务执行超时（${timeoutMs}ms）`);
      (error as Error & { code?: string }).code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    const executionPromise = executor.execute({
      mode: params.mode,
      instruction: params.instruction,
      workspace: params.workspace,
    });

    const result = await Promise.race([executionPromise, timeoutPromise]);
    const duration = Date.now() - startedAt;

    if (result.error) {
      const errorType = getErrorType(result.error);
      return {
        success: false,
        error: result.error,
        errorType,
        duration,
        metadata,
      };
    }

    return {
      success: true,
      output: result.output,
      duration,
      metadata,
    };
  } catch (error) {
    const duration = Date.now() - startedAt;
    const message = (error as Error).message;
    const code = (error as Error & { code?: string }).code;

    return {
      success: false,
      error: message,
      errorType: code === 'TIMEOUT' ? 'timeout' : getErrorType(message),
      duration,
      metadata,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
