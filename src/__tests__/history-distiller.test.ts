import { describe, expect, it } from 'vitest';
import {
  distillAssistantHistoryContent,
  loadAssistantHistoryDistillOptionsFromEnv,
} from '../conversation/history-distiller';

describe('history-distiller', () => {
  it('should keep short assistant content untouched', () => {
    const source = '已完成处理。';
    const result = distillAssistantHistoryContent(source, { minCharsToDistill: 20 });
    expect(result.compacted).toBe(false);
    expect(result.content).toBe(source);
  });

  it('should compact long assistant content into outcome/facts/next-step structure', () => {
    const source = `
安装流程完成，下面是完整说明。
版本: v1.2.3
路径: /Users/demo/.squid/skills/example
文档: https://example.com/skill
建议先运行以下命令：
\`\`\`bash
echo "one"
echo "two"
echo "three"
\`\`\`
${'这是扩展说明。'.repeat(220)}
下一步是否继续安装下一个技能？
`.trim();

    const result = distillAssistantHistoryContent(source, {
      minCharsToDistill: 100,
      maxStoredChars: 500,
      maxFactLines: 5,
    });

    expect(result.compacted).toBe(true);
    expect(result.content).toContain('[assistant_history_compacted]');
    expect(result.content).toContain('Outcome:');
    expect(result.content).toContain('Key facts:');
    expect(result.content).toContain('Next step:');
    expect(result.storedChars).toBeLessThan(result.originalChars);
    expect(result.storedChars).toBeLessThanOrEqual(500);
  });

  it('should load distill options from env', () => {
    const opts = loadAssistantHistoryDistillOptionsFromEnv({
      SQUID_ASSISTANT_HISTORY_DISTILL_MIN_CHARS: '1000',
      SQUID_ASSISTANT_HISTORY_DISTILL_MAX_CHARS: '700',
      SQUID_ASSISTANT_HISTORY_DISTILL_MAX_FACT_LINES: '6',
    } as NodeJS.ProcessEnv);

    expect(opts.minCharsToDistill).toBe(1000);
    expect(opts.maxStoredChars).toBe(700);
    expect(opts.maxFactLines).toBe(6);
  });
});

