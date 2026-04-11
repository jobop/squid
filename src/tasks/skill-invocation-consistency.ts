import { truncateMiddleText } from '../utils/agent-execution-log';

export interface SkillSelectionRecord {
  skillName: string;
  toolCallId: string;
  argsPreview?: string;
}

export interface SkillExecutionRecord extends SkillSelectionRecord {
  status: 'ok' | 'failed';
  errorPreview?: string;
}

export type SkillConsistencyReason =
  | 'claim_without_skill_tool_call'
  | 'claim_with_skill_tool_call_but_all_failed';

export interface SkillConsistencyCheckInput {
  assistantText: string;
  selectedSkills: SkillSelectionRecord[];
  executedSkills: SkillExecutionRecord[];
}

export interface SkillConsistencyCheckResult {
  status: 'ok' | 'warning';
  reason?: SkillConsistencyReason;
  claimSignals: string[];
  selectedSkillNames: string[];
  executedSkillNames: string[];
  failedSkillNames: string[];
}

const SKILL_CLAIM_PATTERNS: RegExp[] = [
  /(?:我|已|已经|将|会|正在|马上).{0,12}(?:调用|使用|执行).{0,8}(?:skill|技能)/giu,
  /(?:按|按照).{0,20}(?:skill|技能).{0,8}(?:执行|处理)/giu,
  /(?:I|we)\s+(?:will|have|already|just|can)?\s*(?:invoke|use|run|call)\s+(?:the\s+)?skill/giu,
  /(?:invoked|used|called)\s+(?:the\s+)?skill/giu,
];

export function detectSkillClaimSignals(assistantText: string): string[] {
  if (!assistantText || !assistantText.trim()) {
    return [];
  }

  const signals = new Set<string>();
  for (const pattern of SKILL_CLAIM_PATTERNS) {
    const matches = assistantText.matchAll(pattern);
    for (const match of matches) {
      const hit = (match[0] || '').trim();
      if (hit) {
        signals.add(hit);
      }
    }
  }

  return Array.from(signals).slice(0, 5);
}

export function checkSkillInvocationConsistency(
  input: SkillConsistencyCheckInput
): SkillConsistencyCheckResult {
  const claimSignals = detectSkillClaimSignals(input.assistantText);
  const selectedSkillNames = Array.from(
    new Set(input.selectedSkills.map((s) => s.skillName))
  );
  const executedSkillNames = Array.from(
    new Set(input.executedSkills.map((s) => s.skillName))
  );
  const failedSkillNames = Array.from(
    new Set(
      input.executedSkills
        .filter((s) => s.status === 'failed')
        .map((s) => s.skillName)
    )
  );

  if (claimSignals.length === 0) {
    return {
      status: 'ok',
      claimSignals,
      selectedSkillNames,
      executedSkillNames,
      failedSkillNames,
    };
  }

  if (selectedSkillNames.length === 0) {
    return {
      status: 'warning',
      reason: 'claim_without_skill_tool_call',
      claimSignals,
      selectedSkillNames,
      executedSkillNames,
      failedSkillNames,
    };
  }

  const allSelectedFailed = selectedSkillNames.every((name) =>
    failedSkillNames.includes(name)
  );
  if (allSelectedFailed) {
    return {
      status: 'warning',
      reason: 'claim_with_skill_tool_call_but_all_failed',
      claimSignals,
      selectedSkillNames,
      executedSkillNames,
      failedSkillNames,
    };
  }

  return {
    status: 'ok',
    claimSignals,
    selectedSkillNames,
    executedSkillNames,
    failedSkillNames,
  };
}

export function buildSkillConsistencyRemediationMessage(
  result: SkillConsistencyCheckResult
): string | null {
  if (result.status !== 'warning') {
    return null;
  }

  if (result.reason === 'claim_without_skill_tool_call') {
    return [
      '你刚才在回答中声明了会/已使用 skill，但没有实际发起 `skill` 工具调用。',
      '请在本轮先调用 `skill` 工具，再继续输出结论，禁止“只提不调”。',
      `检测到的声明信号: ${result.claimSignals.map((s) => `"${truncateMiddleText(s, 40)}"`).join(', ')}`,
    ].join('\n');
  }

  if (result.reason === 'claim_with_skill_tool_call_but_all_failed') {
    return [
      '你刚才的 skill 工具调用全部失败，不能将其表述为“已完成”。',
      '请先修复并重试 skill 调用，或明确说明失败原因与下一步。',
      `失败技能: ${result.failedSkillNames.join(', ') || '(unknown)'}`,
    ].join('\n');
  }

  return null;
}
