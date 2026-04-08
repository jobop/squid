import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { execSync } from 'node:child_process';
import { z } from 'zod';
import { SkillLoader } from '../skills/loader';

const SkillInputSchema = z.object({
  skill_name: z
    .string()
    .describe(
      '技能名称。仅当需要列出本应用已注册技能时，必须填 list-skills（不要用 SkillHub 类技能代替）。'
    ),
  args: z.string().optional().describe('传递给技能的参数（可选）')
});

type SkillInput = z.infer<typeof SkillInputSchema>;

interface SkillOutput {
  success: boolean;
  skillName: string;
  result?: string;
  // 保留字段兼容历史结构；inline skill 模式下通常为空
  duration?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

function isListSkillsAlias(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return (
    normalized === 'list-skills' ||
    normalized === 'list-skills-skill' ||
    normalized === 'list-all-skills' ||
    normalized === 'skills'
  );
}

const TENCENT_SKILLHUB_SKILL = 'find-skills-in-tencent-skillhub';

function commandAvailable(cmd: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore', windowsHide: true });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

export const SkillTool: Tool<typeof SkillInputSchema, SkillOutput> = {
  name: 'skill',
  description:
    '调用本应用已注册的技能。若用户只想查看当前环境可用技能列表（含内置与用户目录），必须使用 skill_name=`list-skills`，不要为此调用腾讯 SkillHub / skillhub CLI 类技能。',
  inputSchema: SkillInputSchema,
  maxResultSizeChars: 100000,

  async call(
    input: SkillInput,
    context: ToolContext
  ): Promise<ToolResult<SkillOutput>> {
    try {
      const loader = new SkillLoader();
      const summaries = await loader.listSkillSummaries();

      if (isListSkillsAlias(input.skill_name)) {
        const invocableSkills = summaries
          .filter((s) => s.userInvocable)
          .map((s) => `- ${s.name}: ${s.description}`)
          .sort();

        const resultText = invocableSkills.length > 0
          ? `可用技能列表（${invocableSkills.length}）:\n${invocableSkills.join('\n')}`
          : '当前没有可用技能。';
        return {
          data: {
            success: true,
            skillName: input.skill_name,
            result: resultText
          }
        };
      }

      // 只有在 LLM 明确选择技能时，才加载该技能 body（systemPrompt）。
      const skill = await loader.loadSkillByName(input.skill_name);

      if (!skill) {
        return {
          data: {
            success: false,
            skillName: input.skill_name,
            error: `技能不存在: ${input.skill_name}`
          },
          error: `Skill not found: ${input.skill_name}`
        };
      }

      // 检查技能是否可被用户调用
      if (!skill.metadata['user-invocable']) {
        return {
          data: {
            success: false,
            skillName: input.skill_name,
            error: `技能 ${input.skill_name} 不可被直接调用`
          },
          error: 'Skill is not user-invocable'
        };
      }

      // 腾讯 SkillHub CLI 技能依赖本机 skillhub 与 jq；缺失时尽快失败并引导 list-skills，避免模型多轮空转。
      if (skill.metadata.name === TENCENT_SKILLHUB_SKILL) {
        const missing: string[] = [];
        if (!commandAvailable('skillhub')) missing.push('skillhub');
        if (!commandAvailable('jq')) missing.push('jq');
        if (missing.length > 0) {
          const hint =
            `本机未检测到 ${missing.join('、')}（PATH 中不可用），无法执行 ${TENCENT_SKILLHUB_SKILL}。` +
            '若用户只是想列出当前应用已注册的技能，请立即改用 skill 工具且 skill_name 为 `list-skills`，勿再调用本技能。';
          return {
            data: {
              success: false,
              skillName: input.skill_name,
              error: hint
            },
            error: hint
          };
        }
      }

      // 采用 inline skill：仅展开技能内容并返回给当前主执行器继续。
      // 这样避免再起一层 TaskExecutor（防止 skill->skill 递归套娃）。
      const instructionParts: string[] = [];
      instructionParts.push(`# Skill: ${skill.metadata.name}`);
      instructionParts.push(
        '以下为技能内容。请在当前对话中继续完成任务；不要再次调用同名 skill，以避免递归。'
      );
      instructionParts.push(skill.systemPrompt.trim());
      if (input.args?.trim()) {
        instructionParts.push(`## Skill Arguments\n${input.args.trim()}`);
      }
      instructionParts.push(
        `## Runtime Context\n- workspace: ${context.workDir}\n- mode: ${context.mode}`
      );

      return {
        data: {
          success: true,
          skillName: skill.metadata.name,
          result: instructionParts.join('\n\n')
        }
      };
    } catch (error) {
      return {
        data: {
          success: false,
          skillName: input.skill_name,
          error: `技能调用失败: ${(error as Error).message}`
        },
        error: (error as Error).message
      };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: SkillOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content.success) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: content.error || '技能调用失败',
        is_error: true
      };
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: content.result || ''
    };
  },

  // 会嵌套 TaskExecutor.execute（整段子任务 + 多轮工具），同轮并行会 N 倍 API 与日志风暴
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isDestructive: () => false
};
