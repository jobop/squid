import { truncateMiddleText } from '../utils/agent-execution-log';

export interface ToolSelectionRecord {
  toolName: string;
  toolCallId: string;
  argsPreview?: string;
}

export interface ToolExecutionRecord extends ToolSelectionRecord {
  status: 'ok' | 'failed';
  errorPreview?: string;
}

export type ToolConsistencyReason =
  | 'tool_selection_missing'
  | 'tool_execution_failed';

export interface ToolConsistencyCheckInput {
  assistantText: string;
  selectedTools: ToolSelectionRecord[];
  executedTools: ToolExecutionRecord[];
}

export interface ToolConsistencyCheckResult {
  status: 'ok' | 'warning';
  reason?: ToolConsistencyReason;
  claimSignals: string[];
  selectedToolNames: string[];
  executedToolNames: string[];
  failedToolNames: string[];
}

const TOOL_CLAIM_PATTERNS: RegExp[] = [
  /(?:我|已|已经|刚刚|将|会|正在|马上).{0,16}(?:调用|使用|执行|运行|验证).{0,24}(?:tool|工具|skill|技能|命令|bash|shell|web[_\-\s]?search|read|write)/giu,
  /(?:I|we)\s+(?:will|have|already|just|can)?\s*(?:invoke|use|run|ran|execute|executed|verify|validated|called)\s+(?:the\s+)?(?:tool|tools|skill|skills|command|bash|shell|web[_\-\s]?search)/giu,
  /(?:已|已经|刚刚).{0,10}(?:验证|确认).{0,24}(?:可用|正常|成功|worked|works)/giu,
];

export function detectToolClaimSignals(assistantText: string): string[] {
  if (!assistantText || !assistantText.trim()) {
    return [];
  }

  const signals = new Set<string>();
  for (const pattern of TOOL_CLAIM_PATTERNS) {
    const matches = assistantText.matchAll(pattern);
    for (const match of matches) {
      const hit = (match[0] || '').trim();
      if (hit) {
        signals.add(hit);
      }
    }
  }
  return Array.from(signals).slice(0, 6);
}

export function checkToolInvocationConsistency(
  input: ToolConsistencyCheckInput
): ToolConsistencyCheckResult {
  const claimSignals = detectToolClaimSignals(input.assistantText);
  const selectedToolNames = Array.from(
    new Set(input.selectedTools.map((item) => item.toolName).filter(Boolean))
  );
  const executedToolNames = Array.from(
    new Set(input.executedTools.map((item) => item.toolName).filter(Boolean))
  );
  const failedToolNames = Array.from(
    new Set(
      input.executedTools
        .filter((item) => item.status === 'failed')
        .map((item) => item.toolName)
        .filter(Boolean)
    )
  );

  if (claimSignals.length === 0) {
    return {
      status: 'ok',
      claimSignals,
      selectedToolNames,
      executedToolNames,
      failedToolNames,
    };
  }

  if (selectedToolNames.length === 0) {
    return {
      status: 'warning',
      reason: 'tool_selection_missing',
      claimSignals,
      selectedToolNames,
      executedToolNames,
      failedToolNames,
    };
  }

  const allSelectedFailed = selectedToolNames.every((name) =>
    failedToolNames.includes(name)
  );
  if (allSelectedFailed) {
    return {
      status: 'warning',
      reason: 'tool_execution_failed',
      claimSignals,
      selectedToolNames,
      executedToolNames,
      failedToolNames,
    };
  }

  return {
    status: 'ok',
    claimSignals,
    selectedToolNames,
    executedToolNames,
    failedToolNames,
  };
}

export function buildToolConsistencyRemediationMessage(
  result: ToolConsistencyCheckResult
): string | null {
  if (result.status !== 'warning') {
    return null;
  }

  if (result.reason === 'tool_selection_missing') {
    return [
      '你刚才在回答中声明了已调用/执行工具，但没有实际发起工具调用。',
      '请先执行对应工具，再继续输出结论，禁止“只提不调”。',
      `检测到的声明信号: ${result.claimSignals.map((s) => `"${truncateMiddleText(s, 40)}"`).join(', ')}`,
    ].join('\n');
  }

  if (result.reason === 'tool_execution_failed') {
    return [
      '你刚才的工具调用全部失败，不能将其表述为“已完成”。',
      '请先修复并重试工具调用，或明确说明失败原因与下一步。',
      `失败工具: ${result.failedToolNames.join(', ') || '(unknown)'}`,
    ].join('\n');
  }

  return null;
}
