import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { getSquidProjectRoot } from '../channels/extensions/config';

const SkillHubInstallInputSchema = z.object({
  mode: z
    .enum(['all', 'cli', 'skill'])
    .optional()
    .describe('安装模式：all（默认，CLI+技能模板）、cli（仅 CLI）、skill（仅技能模板）'),
  install_skills: z
    .boolean()
    .optional()
    .describe('是否安装技能模板到 ~/.squid/skills（默认 true）'),
  kit_url: z
    .string()
    .optional()
    .describe('可选安装包 URL，默认官方 latest.tar.gz'),
  timeout_ms: z.number().optional().describe('超时时间（毫秒），默认 180000'),
});

type SkillHubInstallInput = z.infer<typeof SkillHubInstallInputSchema>;

interface SkillHubInstallOutput {
  success: boolean;
  mode: 'all' | 'cli' | 'skill';
  installSkills: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function buildScriptArgs(input: SkillHubInstallInput): {
  mode: 'all' | 'cli' | 'skill';
  installSkills: boolean;
  args: string[];
} {
  const mode = input.mode ?? 'all';
  const installSkills = input.install_skills ?? true;
  const args: string[] = [];

  if (mode === 'cli') args.push('--cli-only');
  if (mode === 'skill') args.push('--skill-only');
  args.push(installSkills ? '--with-skills' : '--no-skills');

  if (input.kit_url && input.kit_url.trim()) {
    args.push('--kit-url', input.kit_url.trim());
  }

  return { mode, installSkills, args };
}

export const SkillHubInstallTool: Tool<
  typeof SkillHubInstallInputSchema,
  SkillHubInstallOutput
> = {
  name: 'skillhub_install',
  description:
    '内置安装 SkillHub CLI 与技能模板（面向 squid）。默认安装 CLI 到 ~/.skillhub 与命令 skillhub，并安装技能模板到 ~/.squid/skills。',
  inputSchema: SkillHubInstallInputSchema,
  maxResultSizeChars: 100000,

  async call(
    input: SkillHubInstallInput,
    context: ToolContext
  ): Promise<ToolResult<SkillHubInstallOutput>> {
    const timeout = input.timeout_ms ?? 180000;
    const { mode, installSkills, args } = buildScriptArgs(input);
    const scriptsDir = join(getSquidProjectRoot(), 'scripts');
    const scriptPath = join(scriptsDir, 'install-skillhub-for-squid.sh');
    const command = `bash "./install-skillhub-for-squid.sh" ${args.join(' ')}`.trim();

    if (!existsSync(scriptPath)) {
      const error = `Installer script not found: ${scriptPath}`;
      return {
        data: {
          success: false,
          mode,
          installSkills,
          command,
          stdout: '',
          stderr: error,
          exitCode: null,
        },
        error,
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn('bash', ['./install-skillhub-for-squid.sh', ...args], {
        cwd: scriptsDir,
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, timeout);

      const onAbort = () => {
        child.kill('SIGTERM');
      };
      context.abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutId);
        context.abortSignal?.removeEventListener('abort', onAbort);
        if (timedOut) {
          stderr = `${stderr}\n命令执行超时（${timeout}ms）`.trim();
        }
        resolve({
          data: {
            success: !timedOut && code === 0,
            mode,
            installSkills,
            command,
            stdout,
            stderr,
            exitCode: timedOut ? null : code,
          },
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        context.abortSignal?.removeEventListener('abort', onAbort);
        resolve({
          data: {
            success: false,
            mode,
            installSkills,
            command,
            stdout,
            stderr: err.message,
            exitCode: null,
          },
          error: err.message,
        });
      });
    });
  },

  mapToolResultToToolResultBlockParam(
    content: SkillHubInstallOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    let output = `Command: ${content.command}\n`;
    output += `Mode: ${content.mode}\n`;
    output += `Install Skills: ${content.installSkills ? 'true' : 'false'}\n`;
    if (content.exitCode !== null) output += `Exit Code: ${content.exitCode}\n`;
    if (content.stdout) output += `\nStdout:\n${content.stdout}`;
    if (content.stderr) output += `\nStderr:\n${content.stderr}`;

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.trim(),
      is_error: !content.success,
    };
  },

  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => true,
};

