// Memory extraction integration tests
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MemoryExtractor } from '../memory/extractor';
import { MemoryManager } from '../memory/manager';
import { ExtractionMarker } from '../memory/extraction-marker';
import { ConfigManager } from '../memory/config-manager';
import { AutoMemoryManager } from '../memory/auto-manager';
import type { Message } from '../conversation/manager';
import { unlink, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

describe('Memory Extraction System', () => {
  let memoryManager: MemoryManager;
  let extractor: MemoryExtractor;
  let marker: ExtractionMarker;
  let configManager: ConfigManager;
  let autoManager: AutoMemoryManager;
  let isolatedMemoryDir: string;

  beforeAll(async () => {
    isolatedMemoryDir = await mkdtemp(join(tmpdir(), 'squid-mem-ext-'));
    process.env.SQUID_TEST_MEMORY_DIR = isolatedMemoryDir;
  });

  afterAll(async () => {
    delete process.env.SQUID_TEST_MEMORY_DIR;
    await rm(isolatedMemoryDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    memoryManager = new MemoryManager();
    await memoryManager.init();

    extractor = new MemoryExtractor(memoryManager);
    marker = new ExtractionMarker();
    await marker.init();

    configManager = new ConfigManager();
    await configManager.init();

    autoManager = new AutoMemoryManager(memoryManager);
    await autoManager.init();
  });

  afterEach(async () => {
    // Clean up test data — 与 MemoryStorage 实际目录一致（含 SQUID_TEST_MEMORY_DIR）
    try {
      const memoryDir =
        process.env.SQUID_TEST_MEMORY_DIR?.trim() ||
        join(homedir(), '.squid', 'memory');
      const types = ['user', 'feedback', 'project', 'reference'];
      const { unlink: unlinkFile } = await import('fs/promises');

      for (const type of types) {
        try {
          await unlinkFile(join(memoryDir, `${type}.json`));
        } catch {
          /* 文件可能不存在 */
        }
      }

      // Clean up index file
      try {
        await unlink(join(memoryDir, 'MEMORY.md'));
      } catch {}

      // Clean up config files created by this test
      const configDir = join(homedir(), '.squid');
      try {
        await unlink(join(configDir, 'extraction-marker.json'));
      } catch {}
      try {
        await unlink(join(configDir, 'extraction-config.json'));
      } catch {}
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('ExtractionMarker', () => {
    it('should initialize with marker at 0', () => {
      const marker = new ExtractionMarker();
      expect(marker.getMarker('test-conversation')).toBe(0);
    });

    it('should save and retrieve marker', async () => {
      await marker.saveMarker('test-conversation', 5);
      expect(marker.getMarker('test-conversation')).toBe(5);
    });

    it('should reset marker', async () => {
      await marker.saveMarker('test-conversation', 10);
      await marker.resetMarker('test-conversation');
      expect(marker.getMarker('test-conversation')).toBe(0);
    });
  });

  describe('ConfigManager', () => {
    it('should load default config', () => {
      const config = configManager.get();
      expect(config.enabled).toBe(true);
      expect(config.triggerAfterTurns).toBe(5);
      expect(config.cooldownMinutes).toBe(5);
    });

    it('should save and load config', async () => {
      await configManager.save({
        enabled: false,
        triggerAfterTurns: 10
      });

      const config = configManager.get();
      expect(config.enabled).toBe(false);
      expect(config.triggerAfterTurns).toBe(10);
    });

    it('should validate config values', async () => {
      await configManager.save({
        triggerAfterTurns: 100 // Should be clamped to max 20
      });

      const config = configManager.get();
      expect(config.triggerAfterTurns).toBe(20);
    });
  });

  describe('AutoMemoryManager', () => {
    it('should not trigger cleanup below threshold', async () => {
      const shouldCleanup = await autoManager.shouldCleanup();
      expect(shouldCleanup).toBe(false);
    });

    it('should calculate memory score correctly', async () => {
      const memory = await memoryManager.create({
        name: 'Test Memory',
        description: 'Test description',
        type: 'user',
        content: 'Test content'
      });

      const score = autoManager.calculateMemoryScore(memory);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('MemoryExtractor - parseExtractionResponse', () => {
    it('should parse valid JSON response', () => {
      const extractor = new MemoryExtractor(memoryManager);
      const response = JSON.stringify([
        {
          type: 'user',
          name: 'Test Memory',
          description: 'Test description',
          content: 'Test content',
          confidence: 0.9
        }
      ]);

      const result = (extractor as any).parseExtractionResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Memory');
    });

    it('should handle markdown code blocks', () => {
      const extractor = new MemoryExtractor(memoryManager);
      const response = '```json\n[{"type":"user","name":"Test","description":"Desc","content":"Content","confidence":0.8}]\n```';

      const result = (extractor as any).parseExtractionResponse(response);
      expect(result).toHaveLength(1);
    });

    it('should return empty array for invalid JSON', () => {
      const extractor = new MemoryExtractor(memoryManager);
      const response = 'invalid json';

      const result = (extractor as any).parseExtractionResponse(response);
      expect(result).toHaveLength(0);
    });
  });

  describe('MemoryExtractor - similarity calculation', () => {
    it('should calculate similarity correctly', () => {
      const extractor = new MemoryExtractor(memoryManager);

      const text1 = 'I am a full stack developer';
      const text2 = 'I am a full stack developer';
      const similarity = (extractor as any).calculateSimilarity(text1, text2);

      expect(similarity).toBe(1.0);
    });

    it('should detect similar texts', () => {
      const extractor = new MemoryExtractor(memoryManager);

      const text1 = 'I prefer TypeScript for development';
      const text2 = 'I prefer TypeScript for my development work';
      const similarity = (extractor as any).calculateSimilarity(text1, text2);

      expect(similarity).toBeGreaterThan(0.7);
    });

    it('should detect different texts', () => {
      const extractor = new MemoryExtractor(memoryManager);

      const text1 = 'I am a developer';
      const text2 = 'The weather is nice today';
      const similarity = (extractor as any).calculateSimilarity(text1, text2);

      expect(similarity).toBeLessThan(0.3);
    });
  });

  describe('Integration - Memory Creation', () => {
    it('should create memory with correct metadata', async () => {
      const memory = await memoryManager.create({
        name: 'User Role',
        description: 'User is a developer',
        type: 'user',
        content: 'I am a full stack developer working with TypeScript'
      });

      expect(memory.id).toBeDefined();
      expect(memory.metadata.name).toBe('User Role');
      expect(memory.metadata.type).toBe('user');
      expect(memory.metadata.accessCount).toBe(0);
    });

    it('should increment access count', async () => {
      const memory = await memoryManager.create({
        name: 'Test Memory',
        description: 'Test',
        type: 'user',
        content: 'Test content'
      });

      await memoryManager.incrementAccessCount(memory.id);

      // Force reload from disk by creating a new manager instance
      const freshManager = new MemoryManager();
      await freshManager.init();
      const updated = await freshManager.read(memory.id);

      expect(updated?.metadata.accessCount).toBe(1);
    });
  });
});
