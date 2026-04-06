// End-to-end test for memory extraction
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConversationManager } from '../conversation/manager';
import { MemoryManager } from '../memory/manager';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('E2E: Memory Extraction Flow', () => {
  let conversationManager: ConversationManager;
  let conversationId: string;
  let isolatedMemoryDir: string;

  beforeAll(async () => {
    isolatedMemoryDir = await mkdtemp(join(tmpdir(), 'squid-mem-e2e-'));
    process.env.SQUID_TEST_MEMORY_DIR = isolatedMemoryDir;

    conversationManager = new ConversationManager();
    await conversationManager.init();

    // Set a dummy API key (won't actually call API in this test)
    conversationManager.setApiKey('test-key');

    // Create a conversation
    conversationId = await conversationManager.createConversation();
  });

  afterAll(async () => {
    delete process.env.SQUID_TEST_MEMORY_DIR;
    await rm(isolatedMemoryDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should track conversation turns', async () => {
    // Simulate a conversation
    await conversationManager.addMessage(conversationId, 'user', '你好，我是一名全栈开发工程师');
    await conversationManager.addMessage(conversationId, 'assistant', '你好！很高兴认识你。作为全栈开发工程师，你主要使用什么技术栈？');

    await conversationManager.addMessage(conversationId, 'user', '我主要使用 TypeScript 和 React');
    await conversationManager.addMessage(conversationId, 'assistant', '很好的选择！TypeScript 和 React 是现代 Web 开发的主流技术。');

    const messages = conversationManager.getMessages(conversationId);
    expect(messages).toHaveLength(4);
  });

  it('should have extraction config', async () => {
    const { ConfigManager } = await import('../memory/config-manager');
    const configManager = new ConfigManager();
    await configManager.init();

    const config = configManager.get();
    expect(config.enabled).toBe(true);
    expect(config.triggerAfterTurns).toBe(5);
    expect(config.cooldownMinutes).toBe(5);
  });

  it('should track extraction marker', async () => {
    const { ExtractionMarker } = await import('../memory/extraction-marker');
    const marker = new ExtractionMarker();
    await marker.init();

    // Initially at 0
    expect(marker.getMarker(conversationId)).toBe(0);

    // Save marker
    await marker.saveMarker(conversationId, 4);
    expect(marker.getMarker(conversationId)).toBe(4);
  });

  it('should create memory manually', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    const memory = await memoryManager.create({
      name: '全栈开发工程师',
      description: '用户的职业角色',
      type: 'user',
      content: '用户是一名全栈开发工程师，主要使用 TypeScript 和 React 技术栈'
    });

    expect(memory.id).toBeDefined();
    expect(memory.metadata.name).toBe('全栈开发工程师');
    expect(memory.metadata.type).toBe('user');
    expect(memory.metadata.accessCount).toBe(0);
  });

  it('should list memories', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory first
    await memoryManager.create({
      name: 'Test Memory',
      description: 'Test',
      type: 'user',
      content: 'Test content'
    });

    const memories = await memoryManager.list();
    expect(memories.length).toBeGreaterThan(0);

    const userMemories = await memoryManager.getByType('user');
    expect(userMemories.length).toBeGreaterThan(0);
  });

  it('should increment access count', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory first
    const memory = await memoryManager.create({
      name: 'Access Test',
      description: 'Test',
      type: 'user',
      content: 'Test content'
    });

    await memoryManager.incrementAccessCount(memory.id);

    // Reload to verify
    const freshManager = new MemoryManager();
    await freshManager.init();
    const updated = await freshManager.read(memory.id);

    expect(updated?.metadata.accessCount).toBe(1);
  });

  it('should calculate memory score', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory first
    const memory = await memoryManager.create({
      name: 'Score Test',
      description: 'Test',
      type: 'user',
      content: 'Test content'
    });

    const { AutoMemoryManager } = await import('../memory/auto-manager');
    const autoManager = new AutoMemoryManager(memoryManager);

    const score = autoManager.calculateMemoryScore(memory);
    expect(score).toBeGreaterThan(0);
  });

  it('should not trigger cleanup below threshold', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    const { AutoMemoryManager } = await import('../memory/auto-manager');
    const autoManager = new AutoMemoryManager(memoryManager);

    const shouldCleanup = await autoManager.shouldCleanup();
    expect(shouldCleanup).toBe(false);
  });

  it('should search memories', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory with TypeScript keyword
    await memoryManager.create({
      name: 'TypeScript Memory',
      description: 'Test',
      type: 'user',
      content: 'I use TypeScript for development'
    });

    const results = await memoryManager.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('TypeScript');
  });

  it('should update memory', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory first
    const memory = await memoryManager.create({
      name: 'Update Test',
      description: 'Original description',
      type: 'user',
      content: 'Test content'
    });

    const originalId = memory.id;

    const updated = await memoryManager.update(memory.id, {
      description: '更新后的描述'
    });

    expect(updated?.metadata.description).toBe('更新后的描述');
    expect(updated?.id).toBe(originalId);
  });

  it('should delete memory', async () => {
    const memoryManager = new MemoryManager();
    await memoryManager.init();

    // Create a memory first
    const memory = await memoryManager.create({
      name: 'Delete Test',
      description: 'Test',
      type: 'user',
      content: 'Test content'
    });

    const memoryId = memory.id;

    const deleted = await memoryManager.delete(memoryId);
    expect(deleted).toBe(true);

    const found = await memoryManager.read(memoryId);
    expect(found).toBeNull();
  });
});
