// Memory manager for CRUD operations and caching
import { MemoryStorage } from './storage';
import type { Memory, MemoryType, MemoryCreateInput, MemoryUpdateInput } from './types';

export class MemoryManager {
  private storage: MemoryStorage;
  private cache: Map<string, Memory>;
  private cacheTimestamp: number;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor() {
    this.storage = new MemoryStorage();
    this.cache = new Map();
    this.cacheTimestamp = 0;
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  private isCacheValid(): boolean {
    return Date.now() - this.cacheTimestamp < this.CACHE_TTL;
  }

  private invalidateCache(): void {
    this.cache.clear();
    this.cacheTimestamp = 0;
  }

  private generateId(name: string, type: MemoryType): string {
    const timestamp = Date.now();
    const sanitized = name
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .toLowerCase();

    const baseName = sanitized || 'memory';
    return `${type}_${baseName}_${timestamp}`;
  }

  async create(input: MemoryCreateInput): Promise<Memory> {
    const now = new Date().toISOString();
    const id = this.generateId(input.name, input.type);

    const memory: Memory = {
      id,
      metadata: {
        name: input.name,
        description: input.description,
        type: input.type,
        created: now,
        updated: now,
        accessCount: 0,
        autoCreated: (input as any).autoCreated || false
      },
      content: input.content
    };

    await this.storage.writeMemory(input.type, memory);
    this.invalidateCache();

    return memory;
  }

  async read(id: string): Promise<Memory | null> {
    // Try cache first
    if (this.isCacheValid() && this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // Extract type from id (format: type_name_timestamp)
    const type = id.split('_')[0] as MemoryType;
    if (!['user', 'feedback', 'project', 'reference'].includes(type)) {
      // Fallback: search all types
      const memories = await this.list();
      return memories.find(m => m.id === id) || null;
    }

    const memory = await this.storage.readMemory(type, id);

    if (memory) {
      this.cache.set(id, memory);
    }

    return memory;
  }

  async update(id: string, input: MemoryUpdateInput): Promise<Memory | null> {
    const existing = await this.read(id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const newType = input.type || existing.metadata.type;

    // If type changed, need to delete from old type and create in new type
    if (newType !== existing.metadata.type) {
      await this.storage.deleteMemory(existing.metadata.type, id);

      // Generate new ID with new type
      const newId = this.generateId(
        input.name || existing.metadata.name,
        newType
      );

      const memory: Memory = {
        id: newId,
        metadata: {
          name: input.name || existing.metadata.name,
          description: input.description || existing.metadata.description,
          type: newType,
          created: existing.metadata.created,
          updated: now,
          accessCount: existing.metadata.accessCount || 0,
          autoCreated: existing.metadata.autoCreated || false
        },
        content: input.content !== undefined ? input.content : existing.content
      };

      await this.storage.writeMemory(newType, memory);
      this.invalidateCache();
      return memory;
    }

    // Same type, just update
    const memory: Memory = {
      id: existing.id,
      metadata: {
        name: input.name || existing.metadata.name,
        description: input.description || existing.metadata.description,
        type: newType,
        created: existing.metadata.created,
        updated: now,
        accessCount: existing.metadata.accessCount || 0,
        autoCreated: existing.metadata.autoCreated || false
      },
      content: input.content !== undefined ? input.content : existing.content
    };

    await this.storage.writeMemory(newType, memory);
    this.invalidateCache();

    return memory;
  }

  async delete(id: string): Promise<boolean> {
    const memory = await this.read(id);
    if (!memory) {
      return false;
    }

    const deleted = await this.storage.deleteMemory(memory.metadata.type, id);
    if (deleted) {
      this.invalidateCache();
    }

    return deleted;
  }

  async list(type?: MemoryType): Promise<Memory[]> {
    // Use cache if valid and no type filter
    if (!type && this.isCacheValid() && this.cache.size > 0) {
      return Array.from(this.cache.values());
    }

    const memories = await this.storage.listMemories(type);

    // Update cache if no type filter
    if (!type) {
      this.cache.clear();
      for (const memory of memories) {
        this.cache.set(memory.id, memory);
      }
      this.cacheTimestamp = Date.now();
    }

    return memories;
  }

  async search(query: string): Promise<Memory[]> {
    const memories = await this.list();
    const lowerQuery = query.toLowerCase();

    return memories.filter(memory => {
      return (
        memory.metadata.name.toLowerCase().includes(lowerQuery) ||
        memory.metadata.description.toLowerCase().includes(lowerQuery) ||
        memory.content.toLowerCase().includes(lowerQuery)
      );
    });
  }

  async getByName(name: string): Promise<Memory | null> {
    const memories = await this.list();
    return memories.find(m => m.metadata.name === name) || null;
  }

  async getByType(type: MemoryType): Promise<Memory[]> {
    return this.list(type);
  }

  // Increment access count for a memory
  async incrementAccessCount(id: string): Promise<void> {
    const memory = await this.read(id);
    if (!memory) {
      return;
    }

    memory.metadata.accessCount = (memory.metadata.accessCount || 0) + 1;
    memory.metadata.updated = new Date().toISOString();

    await this.storage.writeMemory(memory.metadata.type, memory);
    this.invalidateCache();
  }
}
