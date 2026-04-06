// Memory JSON storage implementation
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { Memory, MemoryType, MemoryMetadata } from './types';

const MAX_MEMORY_BYTES = 4096;

interface MemoryFile {
  memories: Memory[];
}

export class MemoryStorage {
  private memoryDir: string;

  constructor() {
    // 单测隔离：避免并行 vitest 文件互相删除 ~/.squid/memory/*.json
    const fromEnv = process.env.SQUID_TEST_MEMORY_DIR?.trim();
    this.memoryDir = fromEnv ? fromEnv : join(homedir(), '.squid', 'memory');
  }

  async init(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  validateSize(content: string): boolean {
    return Buffer.byteLength(content, 'utf-8') <= MAX_MEMORY_BYTES;
  }

  validateMetadata(metadata: Partial<MemoryMetadata>): boolean {
    return !!(
      metadata.name &&
      metadata.description &&
      metadata.type &&
      metadata.created &&
      metadata.updated
    );
  }

  private async readTypeFile(type: MemoryType): Promise<MemoryFile> {
    const filePath = join(this.memoryDir, `${type}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // 文件不存在，返回空数组
      return { memories: [] };
    }
  }

  private async writeTypeFile(type: MemoryType, data: MemoryFile): Promise<void> {
    const filePath = join(this.memoryDir, `${type}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async readMemory(type: MemoryType, id: string): Promise<Memory | null> {
    const data = await this.readTypeFile(type);
    return data.memories.find(m => m.id === id) || null;
  }

  async writeMemory(type: MemoryType, memory: Memory): Promise<void> {
    if (!this.validateSize(memory.content)) {
      throw new Error(`Memory content exceeds ${MAX_MEMORY_BYTES} bytes limit`);
    }

    const data = await this.readTypeFile(type);
    const index = data.memories.findIndex(m => m.id === memory.id);

    if (index >= 0) {
      data.memories[index] = memory;
    } else {
      data.memories.push(memory);
    }

    await this.writeTypeFile(type, data);
  }

  async deleteMemory(type: MemoryType, id: string): Promise<boolean> {
    const data = await this.readTypeFile(type);
    const originalLength = data.memories.length;
    data.memories = data.memories.filter(m => m.id !== id);

    if (data.memories.length === originalLength) {
      return false; // 没有找到要删除的记忆
    }

    await this.writeTypeFile(type, data);
    return true;
  }

  async listMemories(type?: MemoryType): Promise<Memory[]> {
    const types: MemoryType[] = type ? [type] : ['user', 'feedback', 'project', 'reference'];
    const allMemories: Memory[] = [];

    for (const t of types) {
      const data = await this.readTypeFile(t);
      allMemories.push(...data.memories);
    }

    return allMemories.sort((a, b) =>
      new Date(b.metadata.updated).getTime() - new Date(a.metadata.updated).getTime()
    ).slice(0, 200);
  }

  /** 清空各类型记忆文件（写入空 memories 数组） */
  async clearAllStoredTypes(): Promise<void> {
    const types: MemoryType[] = ['user', 'feedback', 'project', 'reference'];
    for (const t of types) {
      await this.writeTypeFile(t, { memories: [] });
    }
  }
}
