import { describe, expect, it } from 'vitest';
import {
  buildSkillConsistencyRemediationMessage,
  checkSkillInvocationConsistency,
  detectSkillClaimSignals,
} from '../skill-invocation-consistency';

describe('skill-invocation-consistency', () => {
  it('应识别中文 skill 声明信号', () => {
    const signals = detectSkillClaimSignals(
      '我将调用 skill 来完成这个任务，然后给出结果。'
    );
    expect(signals.length).toBeGreaterThan(0);
  });

  it('声明 skill 但未调用工具时返回 warning', () => {
    const result = checkSkillInvocationConsistency({
      assistantText: '我已经使用技能处理完成。',
      selectedSkills: [],
      executedSkills: [],
    });
    expect(result.status).toBe('warning');
    expect(result.reason).toBe('claim_without_skill_tool_call');
    expect(buildSkillConsistencyRemediationMessage(result)).toContain('禁止“只提不调”');
  });

  it('声明 skill 且调用成功时返回 ok', () => {
    const result = checkSkillInvocationConsistency({
      assistantText: 'I will invoke the skill and continue.',
      selectedSkills: [{ skillName: 'github', toolCallId: 'tool_1' }],
      executedSkills: [{ skillName: 'github', toolCallId: 'tool_1', status: 'ok' }],
    });
    expect(result.status).toBe('ok');
    expect(result.selectedSkillNames).toEqual(['github']);
  });

  it('声明 skill 且调用全部失败时返回 warning', () => {
    const result = checkSkillInvocationConsistency({
      assistantText: '我已经调用 skill 处理了。',
      selectedSkills: [{ skillName: 'github', toolCallId: 'tool_1' }],
      executedSkills: [
        {
          skillName: 'github',
          toolCallId: 'tool_1',
          status: 'failed',
          errorPreview: 'timeout',
        },
      ],
    });
    expect(result.status).toBe('warning');
    expect(result.reason).toBe('claim_with_skill_tool_call_but_all_failed');
    expect(buildSkillConsistencyRemediationMessage(result)).toContain('失败技能');
  });
});
