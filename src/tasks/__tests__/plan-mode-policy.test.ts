import { describe, expect, it } from 'vitest';
import path from 'path';
import { ToolRegistry } from '../../tools/registry';
import { ReadFileTool } from '../../tools/read-file';
import { BashTool } from '../../tools/bash';
import { WebFetchTool } from '../../tools/web-fetch';
import { FileEditTool } from '../../tools/file-edit';
import { WriteFileTool } from '../../tools/write-file';
import { AgentTool } from '../../tools/agent';
import {
  PLAN_MODE_ALLOWED_TOOL_NAMES,
  checkPlanModeToolInvocation,
  getCanonicalPlanFilePath,
  getCanonicalPlanFileRelativePath,
  getPlanModeSystemAppendix,
  getToolsForTaskMode,
  isToolInvocationAllowedInPlanMode,
  getParallelToolBatchSystemSection,
  planModeToolRejectionMessage,
} from '../plan-mode-policy';

const WS = path.resolve('/tmp/squid-plan-ws');

describe('plan-mode-policy', () => {
  it('PLAN_MODE_ALLOWED_TOOL_NAMES 含只读、计划写入与 agent', () => {
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('read_file')).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('web_fetch')).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('write_file')).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('file_edit')).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('agent')).toBe(true);
    expect(PLAN_MODE_ALLOWED_TOOL_NAMES.has('bash')).toBe(false);
  });

  it('getToolsForTaskMode plan 仅保留白名单', () => {
    const reg = new ToolRegistry();
    reg.register(ReadFileTool);
    reg.register(BashTool);
    reg.register(WebFetchTool);
    reg.register(FileEditTool);
    reg.register(WriteFileTool);
    reg.register(AgentTool);
    const planTools = getToolsForTaskMode('plan', reg);
    expect(planTools.map((t) => t.name).sort()).toEqual([
      'agent',
      'file_edit',
      'read_file',
      'web_fetch',
      'write_file',
    ]);
    expect(getToolsForTaskMode('craft', reg)).toHaveLength(6);
    expect(getToolsForTaskMode('ask', reg)).toHaveLength(6);
  });

  it('getCanonicalPlanFilePath 无会话时为 .squid/plan.md', () => {
    const p = getCanonicalPlanFilePath(WS);
    expect(p).toBe(path.join(WS, '.squid', 'plan.md'));
  });

  it('getCanonicalPlanFilePath 有会话 id 时带后缀', () => {
    const p = getCanonicalPlanFilePath(WS, 'thread-abc');
    expect(p).toBe(path.join(WS, '.squid', 'plan-thread-abc.md'));
  });

  it('getCanonicalPlanFileRelativePath 与 canonical 一致', () => {
    expect(getCanonicalPlanFileRelativePath(WS)).toBe(path.relative(WS, getCanonicalPlanFilePath(WS)) || '.');
    expect(getCanonicalPlanFileRelativePath(WS, 't')).toContain('.squid');
    expect(getCanonicalPlanFileRelativePath(WS, 't')).toContain('plan-');
  });

  it('getPlanModeSystemAppendix 含相对路径与探索/成文说明', () => {
    const appendix = getPlanModeSystemAppendix(WS, 'sess-1');
    expect(appendix).toContain('唯一允许的写入目标');
    expect(appendix).toContain('探索阶段');
    expect(appendix).toContain('同轮工具并行');
    expect(appendix).toContain(getCanonicalPlanFileRelativePath(WS, 'sess-1'));
    expect(appendix).toContain(getCanonicalPlanFilePath(WS, 'sess-1'));
  });

  it('getParallelToolBatchSystemSection 含自行判断与 isConcurrencySafe 编排说明', () => {
    const s = getParallelToolBatchSystemSection();
    expect(s).toContain('由你判断');
    expect(s).toContain('write_file');
    expect(s).toContain('bash');
  });

  it('plan 下允许 agent 调用', () => {
    const r = checkPlanModeToolInvocation(
      'agent',
      { instruction: '只读搜索 src 目录结构' },
      WS
    );
    expect(r.ok).toBe(true);
  });

  it('checkPlanModeToolInvocation 允许只读工具', () => {
    const r = checkPlanModeToolInvocation('grep', { pattern: 'x', path: '.' }, WS);
    expect(r.ok).toBe(true);
  });

  it('checkPlanModeToolInvocation 拒绝非白名单', () => {
    const r = checkPlanModeToolInvocation('bash', {}, WS);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('bash');
  });

  it('plan 下写 canonical 计划文件（相对路径）允许', () => {
    const r = checkPlanModeToolInvocation(
      'write_file',
      { file_path: '.squid/plan.md', content: '# x' },
      WS
    );
    expect(r.ok).toBe(true);
  });

  it('plan 下写其它业务文件拒绝', () => {
    const r = checkPlanModeToolInvocation(
      'write_file',
      { file_path: 'src/foo.ts', content: '' },
      WS
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('仅允许写入计划文件');
    expect(r.ok === false && r.message).toContain('下一步：请立即使用 write_file');
    expect(r.ok === false && r.message).toMatch(/\.squid[\\/]plan\.md/);
  });

  it('plan 下 .. 穿越拒绝', () => {
    const r = checkPlanModeToolInvocation(
      'write_file',
      { file_path: '../outside.md', content: '' },
      WS
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('越出工作区');
  });

  it('有 conversationId 时仅允许对应 plan 文件路径', () => {
    const canonicalRel = path.relative(WS, getCanonicalPlanFilePath(WS, 'my-thread'));
    const ok = checkPlanModeToolInvocation(
      'file_edit',
      { file_path: canonicalRel, old_string: 'a', new_string: 'b' },
      WS,
      'my-thread'
    );
    expect(ok.ok).toBe(true);

    const bad = checkPlanModeToolInvocation(
      'write_file',
      { file_path: '.squid/plan.md', content: '' },
      WS,
      'my-thread'
    );
    expect(bad.ok).toBe(false);
  });

  it('isToolInvocationAllowedInPlanMode 兼容包装', () => {
    expect(isToolInvocationAllowedInPlanMode('grep', {}, WS)).toBe(true);
    expect(
      isToolInvocationAllowedInPlanMode('file_edit', { file_path: 'x' }, WS)
    ).toBe(false);
  });

  it('planModeToolRejectionMessage 含工具名', () => {
    expect(planModeToolRejectionMessage('bash')).toContain('bash');
    expect(planModeToolRejectionMessage('bash')).toContain('Plan');
  });
});
