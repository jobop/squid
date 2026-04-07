import { spawn } from 'child_process';
import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';

const BashInputSchema = z.object({
  command: z.string().describe('要执行的 Bash 命令'),
  working_directory: z.string().optional().describe('工作目录（可选）'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
  run_in_background: z.boolean().optional().describe('是否在后台运行')
});

type BashInput = z.infer<typeof BashInputSchema>;

interface BashOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  command: string;
  taskId?: string; // 后台任务 ID
}

// 简单的后台任务管理器
const backgroundTasks = new Map<string, { process: any; output: BashOutput }>();

export const BashTool: Tool<typeof BashInputSchema, BashOutput> = {
  name: 'bash',
  description: '执行 Bash 命令。支持超时控制和后台运行。',
  inputSchema: BashInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: BashInput,
    context: ToolContext
  ): Promise<ToolResult<BashOutput>> {
    const timeout = input.timeout || 30000;
    const workDir = input.working_directory || context.workDir;

    // 如果是后台运行
    if (input.run_in_background) {
      const taskId = `bash-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const output: BashOutput = {
        success: true,
        stdout: '',
        stderr: '',
        exitCode: null,
        command: input.command,
        taskId
      };

      const childProcess = spawn('bash', ['-c', input.command], {
        cwd: workDir
      });

      childProcess.stdout?.on('data', (data) => {
        output.stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        output.stderr += data.toString();
      });

      childProcess.on('exit', (code) => {
        output.exitCode = code;
        output.success = code === 0;
      });

      backgroundTasks.set(taskId, { process: childProcess, output });

      return {
        data: {
          success: true,
          stdout: `后台任务已启动，任务 ID: ${taskId}`,
          stderr: '',
          exitCode: null,
          command: input.command,
          taskId
        }
      };
    }

    // 前台执行
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const childProcess = spawn('bash', ['-c', input.command], {
        cwd: workDir
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        timedOut = true;
        childProcess.kill('SIGTERM');

        // 如果 SIGTERM 不起作用，5 秒后强制 SIGKILL
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('exit', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            data: {
              success: false,
              stdout,
              stderr: stderr + `\n命令执行超时（${timeout}ms）`,
              exitCode: null,
              command: input.command
            }
          });
        } else {
          resolve({
            data: {
              success: code === 0,
              stdout,
              stderr,
              exitCode: code,
              command: input.command
            }
          });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          data: {
            success: false,
            stdout,
            stderr: error.message,
            exitCode: null,
            command: input.command
          },
          error: error.message
        });
      });
    });
  },

  mapToolResultToToolResultBlockParam(
    content: BashOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    let output = `Command: ${content.command}\n`;

    if (content.taskId) {
      output += `Task ID: ${content.taskId}\n`;
    }

    if (content.exitCode !== null) {
      output += `Exit Code: ${content.exitCode}\n`;
    }

    if (content.stdout) {
      output += `\nStdout:\n${content.stdout}`;
    }

    if (content.stderr) {
      output += `\nStderr:\n${content.stderr}`;
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.trim(),
      is_error: !content.success
    };
  },

  isConcurrencySafe: () => false,
  isReadOnly: () => false, // 命令可能修改系统状态
  isDestructive: () => true // 命令执行是破坏性操作
};

// 导出后台任务管理器供其他工具使用
export { backgroundTasks };
