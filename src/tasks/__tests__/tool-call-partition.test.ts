import { describe, expect, it } from 'vitest';
import path from 'path';
import { ToolRegistry } from '../../tools/registry';
import { ReadFileTool } from '../../tools/read-file';
import { GrepTool } from '../../tools/grep';
import { WriteFileTool } from '../../tools/write-file';
import { BashTool } from '../../tools/bash';
import {
  partitionToolCalls,
  refineBatchesForDisjointWritePaths,
  itemIsConcurrencySafe,
  executePartitionedBatches,
} from '../tool-call-partition';

function makeRegistry() {
  const reg = new ToolRegistry();
  reg.register(ReadFileTool);
  reg.register(GrepTool);
  reg.register(WriteFileTool);
  reg.register(BashTool);
  return reg;
}

describe('tool-call-partition', () => {
  it('相邻只读合并为一批并发', () => {
    const reg = makeRegistry();
    const items = [
      { toolName: 'read_file', rawArguments: '{"file_path":"a.txt"}' },
      { toolName: 'grep', rawArguments: '{"pattern":"x","path":"."}' },
    ];
    const b = partitionToolCalls(reg, items);
    expect(b).toHaveLength(1);
    expect(b[0].concurrent).toBe(true);
    expect(b[0].items).toHaveLength(2);
  });

  it('safe + unsafe + safe 分为三批', () => {
    const reg = makeRegistry();
    const items = [
      { toolName: 'read_file', rawArguments: '{"file_path":"a.txt"}' },
      { toolName: 'bash', rawArguments: '{"command":"echo hi"}' },
      { toolName: 'grep', rawArguments: '{"pattern":"x","path":"."}' },
    ];
    const b = partitionToolCalls(reg, items);
    expect(b).toHaveLength(3);
    expect(b[0].concurrent).toBe(true);
    expect(b[1].concurrent).toBe(false);
    expect(b[2].concurrent).toBe(true);
  });

  it('JSON 解析失败视为不可并发', () => {
    const reg = makeRegistry();
    expect(itemIsConcurrencySafe(reg, 'read_file', 'not json{')).toBe(false);
    const b = partitionToolCalls(reg, [{ toolName: 'read_file', rawArguments: 'not json{' }]);
    expect(b[0].concurrent).toBe(false);
  });

  it('未知工具不可并发', () => {
    const reg = makeRegistry();
    expect(itemIsConcurrencySafe(reg, 'nope', '{}')).toBe(false);
  });

  it('refine 同路径双 write 降级为串行批', () => {
    const reg = makeRegistry();
    const ws = path.resolve('/tmp/squid-partition-ws');
    const items = [
      { toolName: 'write_file', rawArguments: JSON.stringify({ file_path: 'a/x.txt', content: '1' }) },
      { toolName: 'write_file', rawArguments: JSON.stringify({ file_path: 'a/x.txt', content: '2' }) },
    ];
    const batches = partitionToolCalls(reg, items);
    expect(batches).toHaveLength(1);
    expect(batches[0].concurrent).toBe(true);
    refineBatchesForDisjointWritePaths(batches, ws);
    expect(batches[0].concurrent).toBe(false);
  });

  it('refine 不同路径写保持并发', () => {
    const reg = makeRegistry();
    const ws = path.resolve('/tmp/squid-partition-ws');
    const items = [
      { toolName: 'write_file', rawArguments: JSON.stringify({ file_path: 'a/x.txt', content: '1' }) },
      { toolName: 'write_file', rawArguments: JSON.stringify({ file_path: 'a/y.txt', content: '2' }) },
    ];
    const batches = partitionToolCalls(reg, items);
    refineBatchesForDisjointWritePaths(batches, ws);
    expect(batches[0].concurrent).toBe(true);
  });

  it('refine 同批 read 与 write 同路径则降级', () => {
    const reg = makeRegistry();
    const ws = path.resolve('/tmp/squid-partition-ws');
    const items = [
      { toolName: 'read_file', rawArguments: JSON.stringify({ file_path: 'a/x.txt' }) },
      { toolName: 'write_file', rawArguments: JSON.stringify({ file_path: 'a/x.txt', content: 'z' }) },
    ];
    const batches = partitionToolCalls(reg, items);
    expect(batches[0].concurrent).toBe(true);
    refineBatchesForDisjointWritePaths(batches, ws);
    expect(batches[0].concurrent).toBe(false);
  });

  it('executePartitionedBatches 输出顺序与 tool_calls 一致', async () => {
    const reg = makeRegistry();
    const items = [
      { toolName: 'read_file', rawArguments: '{"file_path":"a.txt"}' },
      { toolName: 'bash', rawArguments: '{"command":"echo hi"}' },
    ];
    const batches = partitionToolCalls(reg, items);
    let seq = 0;
    const started: number[] = [];
    const results = await executePartitionedBatches(batches, async (it) => {
      started.push(++seq);
      if (it.toolName === 'read_file') {
        await new Promise((r) => setTimeout(r, 5));
      }
      return it.toolName;
    });
    expect(results).toEqual(['read_file', 'bash']);
    expect(started).toEqual([1, 2]);
  });
});
