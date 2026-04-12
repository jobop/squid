// Conversation history manager
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ConversationCompressor, loadConversationCompressionOptionsFromEnv } from './compressor';
import { MemoryExtractor } from '../memory/extractor';
import { MemoryManager } from '../memory/manager';
import { ExtractionMarker } from '../memory/extraction-marker';
import { ConfigManager } from '../memory/config-manager';
import { ExtractionStateManager } from '../memory/extraction-state';
import type { ExtractionState } from '../memory/extraction-state';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  workspace?: string;
  /**
   * Cross-request tool compaction state for round-aware context trimming.
   * Stored with conversation to preserve tool-round aging across executeTaskStream calls.
   */
  toolCompactionState?: {
    roundCounter: number;
    records: Array<{
      round: number;
      toolName: string;
      toolCallId: string;
      rawArguments?: string;
      content: string;
      isError?: boolean;
      compacted?: boolean;
      pruned?: boolean;
      lastReferencedRound?: number;
      tokenBucket?: 'short' | 'mid' | 'long';
      policyTag?: 'always_keep' | 'always_compact' | 'normal';
      anchors?: string[];
    }>;
  };
}

export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private configDir: string;
  private compressor: ConversationCompressor;
  private memoryExtractor: MemoryExtractor;
  private extractionMarker: ExtractionMarker;
  private configManager: ConfigManager;
  private extractionStateManager: ExtractionStateManager;
  private apiKey?: string;
  private baseURL?: string;
  private modelName?: string;

  constructor() {
    this.configDir = join(homedir(), '.squid', 'conversations');
    this.compressor = new ConversationCompressor(loadConversationCompressionOptionsFromEnv());

    // Initialize memory extraction components
    const memoryManager = new MemoryManager();
    this.memoryExtractor = new MemoryExtractor(memoryManager);
    this.extractionMarker = new ExtractionMarker();
    this.configManager = new ConfigManager();
    this.extractionStateManager = new ExtractionStateManager();
  }

  setApiKey(apiKey: string, baseURL?: string, modelName?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.modelName = modelName;
    this.memoryExtractor.setApiKey(apiKey, baseURL, modelName);
  }

  async init() {
    try {
      await mkdir(this.configDir, { recursive: true });
      await this.extractionMarker.init();
      await this.configManager.init();
      await this.extractionStateManager.init();
    } catch (error) {
      // Directory already exists
    }
  }

  async createConversation(workspace?: string): Promise<string> {
    const id = Date.now().toString();
    const conversation: Conversation = {
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspace
    };

    this.conversations.set(id, conversation);
    await this.saveConversation(id);
    return id;
  }

  /** 固定 ID（如飞书会话 `feishubot_<chat_id>`），不存在则创建 */
  async createConversationWithId(conversationId: string, workspace?: string): Promise<void> {
    if (this.conversations.has(conversationId)) {
      return;
    }
    const conversation: Conversation = {
      id: conversationId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspace
    };
    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversationId);
  }

  async addMessage(conversationId: string, role: 'user' | 'assistant', content: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    conversation.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });

    conversation.updatedAt = new Date().toISOString();

    // Update turn count for extraction trigger
    if (role === 'assistant') {
      const state = this.getExtractionState(conversationId);
      state.turnCount++;

      // Check if should trigger extraction
      if (this.shouldTriggerExtraction(conversationId)) {
        this.triggerExtraction(conversationId).catch(err => {
          console.error('Background extraction failed:', err);
        });
      }
    }

    // Auto-compress if needed
    const usage = this.compressor.getUsagePercentage(conversation.messages);
    const estimatedTokens = this.compressor.getEstimatedTokens(conversation.messages);
    const triggerUsage = this.compressor.getAutoCompressTriggerPercentage();
    if (usage > triggerUsage) {
      try {
        const result = await this.compressor.compress(conversation.messages);
        const usageAfter = this.compressor.getUsagePercentage(result.messages);
        if (result.compressed) {
          conversation.messages = result.messages;
          console.log(
            `[ConversationCompression] compressed conversation=${conversationId} strategy=${result.strategy} tokens_before=${estimatedTokens} tokens_saved=${result.tokensSaved} usage_before=${usage.toFixed(2)}% usage_after=${usageAfter.toFixed(2)}%`
          );
        } else {
          console.log(
            `[ConversationCompression] skipped conversation=${conversationId} usage=${usage.toFixed(2)}% trigger=${triggerUsage.toFixed(2)}% estimated_tokens=${estimatedTokens}`
          );
        }
      } catch (error) {
        console.error('Auto-compression failed:', error);
      }
    }

    await this.saveConversation(conversationId);
  }

  getMessages(conversationId: string): Message[] {
    const conversation = this.conversations.get(conversationId);
    return conversation?.messages || [];
  }

  getConversation(conversationId: string): Conversation | null {
    return this.conversations.get(conversationId) || null;
  }

  getToolCompactionState(conversationId: string): Conversation['toolCompactionState'] {
    const conversation = this.conversations.get(conversationId);
    return conversation?.toolCompactionState;
  }

  async setToolCompactionState(
    conversationId: string,
    state: Conversation['toolCompactionState']
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.toolCompactionState = state;
    conversation.updatedAt = new Date().toISOString();
    await this.saveConversation(conversationId);
  }

  async setConversationWorkspace(conversationId: string, workspace: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.workspace = workspace;
    conversation.updatedAt = new Date().toISOString();
    await this.saveConversation(conversationId);
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const filePath = join(this.configDir, `${conversationId}.json`);
      const content = await readFile(filePath, 'utf-8');
      const conversation = JSON.parse(content);
      this.conversations.set(conversationId, conversation);
      return conversation;
    } catch (error) {
      return null;
    }
  }

  private async saveConversation(conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    try {
      const filePath = join(this.configDir, `${conversationId}.json`);
      await writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }

  async listConversations(): Promise<Conversation[]> {
    // TODO: Implement listing all conversations
    return Array.from(this.conversations.values());
  }

  async clearConversation(conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      // Trigger extraction before clearing if enabled
      const config = this.configManager.get();
      if (config.enabled && config.triggerOnEnd) {
        this.triggerExtraction(conversationId).catch(err => {
          console.error('Extraction on clear failed:', err);
        });
      }

      conversation.messages = [];
      conversation.toolCompactionState = undefined;
      conversation.updatedAt = new Date().toISOString();
      await this.saveConversation(conversationId);

      // Reset extraction state
      await this.extractionStateManager.resetState(conversationId);
      this.extractionMarker.resetMarker(conversationId);
    }
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      const filePath = join(this.configDir, `${conversationId}.json`);
      this.conversations.delete(conversationId);
      await rm(filePath, { force: true });
      await this.extractionStateManager.resetState(conversationId);
      await this.extractionMarker.resetMarker(conversationId);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      return false;
    }
  }

  // Get or create extraction state for a conversation
  private getExtractionState(conversationId: string): ExtractionState {
    return this.extractionStateManager.getState(conversationId);
  }

  // Check if should trigger extraction
  private shouldTriggerExtraction(conversationId: string): boolean {
    const config = this.configManager.get();

    // Check if extraction is enabled
    if (!config.enabled) {
      return false;
    }

    const state = this.getExtractionState(conversationId);

    // Check if already in progress
    if (state.inProgress) {
      return false;
    }

    // Check cooldown period
    const now = Date.now();
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    if (now - state.lastExtractionTime < cooldownMs) {
      return false;
    }

    // Check turn count threshold
    if (state.turnCount >= config.triggerAfterTurns) {
      return true;
    }

    return false;
  }

  // Trigger extraction asynchronously
  private async triggerExtraction(conversationId: string): Promise<void> {
    const state = this.getExtractionState(conversationId);
    const conversation = this.conversations.get(conversationId);

    if (!conversation || state.inProgress) {
      return;
    }

    state.inProgress = true;

    try {
      // Get messages since last marker
      const marker = this.extractionMarker.getMarker(conversationId);
      const newMessages = conversation.messages.slice(marker);

      if (newMessages.length === 0) {
        return;
      }

      // Extract and save memories
      const result = await this.memoryExtractor.extractAndSave(
        newMessages,
        this.apiKey,
        this.baseURL,
        this.modelName
      );

      console.log(`[Extraction] Created: ${result.created}, Skipped: ${result.skipped}`);

      if (result.errors.length > 0) {
        console.error('[Extraction] Errors:', result.errors);
      }

      // Update marker and state
      await this.extractionMarker.saveMarker(conversationId, conversation.messages.length);
      state.lastExtractionTime = Date.now();
      state.turnCount = 0;
    } catch (error: any) {
      console.error('[Extraction] Failed:', error);
    } finally {
      state.inProgress = false;
    }
  }

  // Manual extraction trigger
  async manualExtraction(conversationId: string): Promise<{
    success: boolean;
    created: number;
    skipped: number;
    errors: string[];
  }> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return {
        success: false,
        created: 0,
        skipped: 0,
        errors: ['Conversation not found']
      };
    }

    try {
      const marker = this.extractionMarker.getMarker(conversationId);
      const newMessages = conversation.messages.slice(marker);

      if (newMessages.length === 0) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          errors: ['No new messages to analyze']
        };
      }

      const result = await this.memoryExtractor.extractAndSave(
        newMessages,
        this.apiKey,
        this.baseURL,
        this.modelName
      );

      // Update marker
      await this.extractionMarker.saveMarker(conversationId, conversation.messages.length);

      // Update extraction state
      const state = this.getExtractionState(conversationId);
      state.lastExtractionTime = Date.now();
      state.turnCount = 0;

      return {
        success: true,
        ...result
      };
    } catch (error: any) {
      return {
        success: false,
        created: 0,
        skipped: 0,
        errors: [error.message]
      };
    }
  }

  async compressConversation(conversationId: string, manual: boolean = false): Promise<{ success: boolean; strategy?: string; tokensSaved?: number; error?: string }> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return { success: false, error: 'Conversation not found' };
    }

    try {
      const result = manual
        ? await this.compressor.manualCompress(conversation.messages)
        : await this.compressor.compress(conversation.messages);

      if (result.compressed) {
        conversation.messages = result.messages;
        conversation.updatedAt = new Date().toISOString();
        await this.saveConversation(conversationId);

        return {
          success: true,
          strategy: result.strategy,
          tokensSaved: result.tokensSaved
        };
      }

      return { success: false, error: 'No compression needed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getUsagePercentage(conversationId: string): number {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return 0;
    }
    return this.compressor.getUsagePercentage(conversation.messages);
  }
}
