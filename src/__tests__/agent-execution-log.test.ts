import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendAgentLog,
  clearAgentLogs,
  getAgentLogs,
  truncateText,
} from '../utils/agent-execution-log';

describe('agent-execution-log', () => {
  beforeEach(() => {
    clearAgentLogs();
  });

  it('append and get entries', () => {
    appendAgentLog('test', 'info', 'hello', { a: 1 });
    const { entries, total } = getAgentLogs({ limit: 10 });
    expect(total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('hello');
    expect(entries[0].category).toBe('test');
    expect(entries[0].meta).toEqual({ a: 1 });
  });

  it('clear removes all', () => {
    appendAgentLog('x', 'debug', 'm');
    clearAgentLogs();
    expect(getAgentLogs().total).toBe(0);
  });

  it('truncateText', () => {
    expect(truncateText('abc', 10)).toBe('abc');
    expect(truncateText('x'.repeat(20), 5).endsWith('…')).toBe(true);
  });
});
