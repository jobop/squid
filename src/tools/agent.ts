import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { executeWithUnifiedStack } from './unified-executor';

const AgentInputSchema = z.object({
  instruction: z
    .string()
    .describe(
      '子任务说明。若主会话同轮会发多个 agent，且各子任务都要写入同一文件（如都写 hello.all），请勿这样并发：应分轮 agent 或由主会话合并后一次写入。'
    ),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 300000（5分钟）')
});

type AgentInput = z.infer<typeof AgentInputSchema>;

interface AgentOutput {
  success: boolean;
  result?: string;
  instruction: string;
  duration?: number;
  errorType?: 'timeout' | 'config' | 'execution';
  metadata?: {
    executor: 'TaskExecutor';
    mode: 'ask' | 'craft' | 'plan';
    workspace: string;
    timeoutMs: number;
  };
  error?: string;
}

export const AgentTool: Tool<typeof AgentInputSchema, AgentOutput> = {
  name: 'agent',
  description:
    '创建子代理执行复杂任务。子代理有独立对话上下文；工具集含 read_file、write_file、bash、skill 等与主会话相近的能力（不含嵌套 agent）。**同轮多个 agent 若都会写同一 file_path，宿主会并行执行导致互相覆盖**——请由主会话分轮调用或合并写入。已安装且 user-invocable 的 skill 可在子任务中通过 skill 工具调用。',
  inputSchema: AgentInputSchema,
  maxResultSizeChars: 100000,

  async call(
    input: AgentInput,
    context: ToolContext
  ): Promise<ToolResult<AgentOutput>> {
    const timeout = input.timeout || 300000; // 默认 5 分钟

    const execution = await executeWithUnifiedStack({
      instruction: input.instruction,
      workspace: context.workDir,
      mode: context.mode,
      timeoutMs: timeout,
    });

    if (!execution.success) {
      return {
        data: {
          success: false,
          instruction: input.instruction,
          duration: execution.duration,
          errorType: execution.errorType,
          metadata: execution.metadata,
          error: execution.error || '子代理执行失败'
        },
        error: execution.error || 'Agent execution failed'
      };
    }

    return {
      data: {
        success: true,
        result: execution.output || '',
        instruction: input.instruction,
        duration: execution.duration,
        metadata: execution.metadata
      }
    };
  },

  mapToolResultToToolResultBlockParam(
    content: AgentOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content.success) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: content.error || '子代理执行失败',
        is_error: true
      };
    }

    let output = `子代理任务: ${content.instruction}\n`;

    if (content.metadata) {
      output += `执行器: ${content.metadata.executor}\n`;
      output += `模式: ${content.metadata.mode}\n`;
      output += `工作目录: ${content.metadata.workspace}\n`;
    }

    if (content.duration) {
      output += `执行时间: ${content.duration}ms\n`;
    }

    output += `\n结果:\n${content.result || ''}`;

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output
    };
  },

  // 子代理即完整 execute，同轮并行会重复嵌套执行器
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => false // 取决于子代理执行的任务
};
