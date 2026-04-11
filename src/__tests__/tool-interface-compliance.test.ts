import { describe, it, expect } from 'vitest';
import { FileEditTool } from '../tools/file-edit';
import { BashTool } from '../tools/bash';
import { PowerShellTool } from '../tools/powershell';
import { WebSearchTool } from '../tools/web-search';
import { CronCreateTool } from '../tools/cron-create';
import { CronDeleteTool } from '../tools/cron-delete';
import { CronListTool } from '../tools/cron-list';
import { CronStatusTool } from '../tools/cron-status';
import { CronRunsTool } from '../tools/cron-runs';
import { SkillTool } from '../tools/skill';
import { SkillHubInstallTool } from '../tools/skillhub-install';
import { BriefTool } from '../tools/brief';
import { AgentTool } from '../tools/agent';
import type { Tool } from '../tools/base';

describe('Tool Interface Compliance', () => {
  const tools: Array<{ name: string; tool: Tool<any, any> }> = [
    { name: 'FileEditTool', tool: FileEditTool },
    { name: 'BashTool', tool: BashTool },
    { name: 'PowerShellTool', tool: PowerShellTool },
    { name: 'WebSearchTool', tool: WebSearchTool },
    { name: 'CronCreateTool', tool: CronCreateTool },
    { name: 'CronDeleteTool', tool: CronDeleteTool },
    { name: 'CronListTool', tool: CronListTool },
    { name: 'CronStatusTool', tool: CronStatusTool },
    { name: 'CronRunsTool', tool: CronRunsTool },
    { name: 'SkillTool', tool: SkillTool },
    { name: 'SkillHubInstallTool', tool: SkillHubInstallTool },
    { name: 'BriefTool', tool: BriefTool },
    { name: 'AgentTool', tool: AgentTool }
  ];

  tools.forEach(({ name, tool }) => {
    describe(name, () => {
      it('应该有 name 属性', () => {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
      });

      it('应该有 description 属性', () => {
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
      });

      it('应该有 inputSchema 属性', () => {
        expect(tool.inputSchema).toBeDefined();
      });

      it('应该有 maxResultSizeChars 属性', () => {
        expect(tool.maxResultSizeChars).toBeDefined();
        expect(typeof tool.maxResultSizeChars).toBe('number');
        expect(tool.maxResultSizeChars).toBeGreaterThan(0);
      });

      it('应该有 call 方法', () => {
        expect(tool.call).toBeDefined();
        expect(typeof tool.call).toBe('function');
      });

      it('应该有 mapToolResultToToolResultBlockParam 方法', () => {
        expect(tool.mapToolResultToToolResultBlockParam).toBeDefined();
        expect(typeof tool.mapToolResultToToolResultBlockParam).toBe('function');
      });

      it('应该有 isConcurrencySafe 方法', () => {
        expect(tool.isConcurrencySafe).toBeDefined();
        expect(typeof tool.isConcurrencySafe).toBe('function');
        const result = tool.isConcurrencySafe();
        expect(typeof result).toBe('boolean');
      });

      it('应该有 isReadOnly 方法', () => {
        expect(tool.isReadOnly).toBeDefined();
        expect(typeof tool.isReadOnly).toBe('function');
        const result = tool.isReadOnly();
        expect(typeof result).toBe('boolean');
      });

      it('应该有 isDestructive 方法（可选）', () => {
        if (tool.isDestructive) {
          expect(typeof tool.isDestructive).toBe('function');
          const result = tool.isDestructive();
          expect(typeof result).toBe('boolean');
        }
      });
    });
  });

  it('所有工具名称应该唯一', () => {
    const names = tools.map(t => t.tool.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('所有工具应该有合理的 maxResultSizeChars', () => {
    tools.forEach(({ name, tool }) => {
      expect(tool.maxResultSizeChars).toBeGreaterThan(0);
      expect(tool.maxResultSizeChars).toBeLessThanOrEqual(Infinity);
    });
  });
});
