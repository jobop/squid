import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillTool } from '../tools/skill';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolContext } from '../tools/base';

describe('SkillTool', () => {
  const testSkillsDir = join(homedir(), '.squid', 'skills');
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  beforeEach(async () => {
    await mkdir(testSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testSkillsDir, { recursive: true, force: true });
  });

  it('应该成功加载并以内联方式展开技能', async () => {
    const skillContent = `---
name: test-skill
description: Test skill for testing
when-to-use: For testing purposes
allowed-tools:
  - read_file
  - write_file
effort: low
user-invocable: true
---

This is a test skill system prompt.
Execute the test task.`;

    await writeFile(join(testSkillsDir, 'test-skill.md'), skillContent);
    const result = await SkillTool.call(
      {
        skill_name: 'test-skill'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.skillName).toBe('test-skill');
    expect(result.data.result).toContain('# Skill: test-skill');
    expect(result.data.result).toContain('This is a test skill system prompt.');
  });

  it('应该支持传递参数', async () => {
    const skillContent = `---
name: param-skill
description: Skill with parameters
when-to-use: When parameters are needed
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Skill with parameters.`;

    await writeFile(join(testSkillsDir, 'param-skill.md'), skillContent);
    const result = await SkillTool.call(
      {
        skill_name: 'param-skill',
        args: 'test arguments'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.result).toContain('## Skill Arguments');
    expect(result.data.result).toContain('test arguments');
  });

  it('应该返回错误当技能不存在', async () => {
    const result = await SkillTool.call(
      {
        skill_name: 'nonexistent-skill'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('技能不存在');
  });

  it('应该支持 list_skills 别名并返回技能清单', async () => {
    const skillContent = `---
name: listed-skill
description: skill for list alias
when-to-use: list testing
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

List skill prompt.`;

    await writeFile(join(testSkillsDir, 'listed-skill.md'), skillContent);
    const result = await SkillTool.call(
      {
        skill_name: 'list_skills'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.result).toContain('可用技能列表');
    expect(result.data.result).toContain('listed-skill');
  });

  it('应该支持下划线与连字符技能名兼容匹配', async () => {
    const skillContent = `---
name: creator-alpha-feed
description: alias matching
when-to-use: alias test
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Alias prompt.`;

    await writeFile(join(testSkillsDir, 'creator-alpha-feed.md'), skillContent);
    const result = await SkillTool.call(
      {
        skill_name: 'creator_alpha_feed'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.skillName).toBe('creator-alpha-feed');
    expect(result.data.result).toContain('# Skill: creator-alpha-feed');
  });

  it('应该拒绝不可调用的技能', async () => {
    const skillContent = `---
name: internal-skill
description: Internal skill
when-to-use: Internal use only
allowed-tools:
  - read_file
effort: low
user-invocable: false
---

Internal skill prompt.`;

    await writeFile(join(testSkillsDir, 'internal-skill.md'), skillContent);

    const result = await SkillTool.call(
      {
        skill_name: 'internal-skill'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('不可被直接调用');
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      skillName: 'test-skill',
      result: 'Skill execution result'
    };

    const result = SkillTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toBe('Skill execution result');
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化错误', () => {
    const output = {
      success: false,
      skillName: 'test-skill',
      error: 'Skill not found'
    };

    const result = SkillTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toBe('Skill not found');
    expect(result.is_error).toBe(true);
  });

  it('应该正确标记为只读操作', () => {
    expect(SkillTool.isConcurrencySafe()).toBe(false);
    expect(SkillTool.isReadOnly()).toBe(false);
    expect(SkillTool.isDestructive?.()).toBe(false);
  });
});
