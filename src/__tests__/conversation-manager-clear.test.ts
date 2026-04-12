import { describe, expect, it } from 'vitest';
import { ConversationManager } from '../conversation/manager';

describe('ConversationManager.clearConversation', () => {
  it('清空会话时应同时清空 toolCompactionState', async () => {
    const manager = new ConversationManager();
    await manager.init();

    const conversationId = await manager.createConversation();
    try {
      await manager.addMessage(conversationId, 'user', 'hello');
      await manager.addMessage(conversationId, 'assistant', 'world');

      await manager.setToolCompactionState(conversationId, {
        roundCounter: 7,
        records: [
          {
            round: 7,
            toolName: 'bash',
            toolCallId: 'tool-1',
            content: '[tool_result_compacted_v2] tool=bash round=7 bucket=short original_tokens=80',
          },
        ],
      });

      expect(manager.getToolCompactionState(conversationId)?.roundCounter).toBe(7);
      expect(manager.getMessages(conversationId).length).toBeGreaterThan(0);

      await manager.clearConversation(conversationId);

      expect(manager.getMessages(conversationId)).toHaveLength(0);
      expect(manager.getToolCompactionState(conversationId)).toBeUndefined();
    } finally {
      await manager.deleteConversation(conversationId);
    }
  });
});
