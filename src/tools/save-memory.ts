// Save Memory Tool - Allow LLM to save important information to long-term memory
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { MemoryManager } from '../memory/manager';
import type { Memory } from '../memory/types';

const SaveMemoryInputSchema = z.object({
  type: z.enum(['user', 'feedback', 'project', 'reference']).describe('Memory type: user (user info), feedback (suggestions/preferences), project (project info), reference (reference materials)'),
  name: z.string().describe('Short name for this memory (e.g., "user_role", "preferred_style")'),
  description: z.string().describe('Brief description of what this memory contains'),
  content: z.string().describe('The actual content to remember')
});

type SaveMemoryInput = z.infer<typeof SaveMemoryInputSchema>;
type SaveMemoryOutput = { id: string; message: string };
type SaveMemoryType = SaveMemoryInput['type'];

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenizeText(value: string): string[] {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isDescriptionNear(source: string, target: string): boolean {
  const a = normalizeText(source);
  const b = normalizeText(target);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 16 && b.length >= 16 && (a.includes(b) || b.includes(a))) return true;

  const tokensA = new Set(tokenizeText(a));
  const tokensB = new Set(tokenizeText(b));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const score = union === 0 ? 0 : intersection / union;
  return score >= 0.72;
}

export class SaveMemoryTool implements Tool<typeof SaveMemoryInputSchema, SaveMemoryOutput> {
  name = 'save_memory';
  description = 'Save important information to long-term memory. Use this when the user explicitly asks you to remember something (e.g., "记住...", "请记住...", "remember that..."). Choose the appropriate type: user (user preferences/info), feedback (suggestions on how to work), project (project-related info), reference (general reference materials).';
  inputSchema = SaveMemoryInputSchema;
  maxResultSizeChars = 1000;

  private memoryManager: MemoryManager;

  constructor() {
    this.memoryManager = new MemoryManager();
    this.memoryManager.init().catch(err => {
      console.error('Failed to initialize MemoryManager in SaveMemoryTool:', err);
    });
  }

  async call(
    input: SaveMemoryInput,
    context: ToolContext
  ): Promise<ToolResult<SaveMemoryOutput>> {
    try {
      // 验证输入参数
      if (!input || typeof input !== 'object') {
        throw new Error('Invalid input: expected an object');
      }

      if (!input.type || !input.name || !input.description || !input.content) {
        throw new Error(`Missing required fields. Received: ${JSON.stringify(input)}`);
      }

      // 确保所有字段都是字符串
      const type = String(input.type);
      const name = String(input.name);
      const description = String(input.description);
      const content = String(input.content);
      const typedType = type as SaveMemoryType;
      const normalizedName = normalizeText(name);

      const sameTypeMemories = await this.memoryManager.list(typedType);

      const exactByTypeAndName = sameTypeMemories.find(
        (memory: Memory) => normalizeText(memory.metadata.name) === normalizedName
      );
      if (exactByTypeAndName) {
        const updated = await this.memoryManager.update(exactByTypeAndName.id, {
          description,
          content,
        });
        const resolvedId = updated?.id || exactByTypeAndName.id;
        return {
          data: {
            id: resolvedId,
            message: `Memory deduplicated by type+name. Updated existing memory ID: ${resolvedId}. Type: ${type}, Name: ${name}`
          }
        };
      }

      const nearByDescription = sameTypeMemories.find((memory: Memory) =>
        isDescriptionNear(memory.metadata.description, description)
      );
      if (nearByDescription) {
        return {
          data: {
            id: nearByDescription.id,
            message: `Memory deduplicated by similar description. Reusing memory ID: ${nearByDescription.id}. Type: ${type}, Name: ${nearByDescription.metadata.name}`
          }
        };
      }

      // Create memory
      const memory = await this.memoryManager.create({
        type: typedType,
        name: name,
        description: description,
        content: content
      });

      return {
        data: {
          id: memory.id,
          message: `Memory saved successfully with ID: ${memory.id}. Type: ${type}, Name: ${name}`
        }
      };
    } catch (error: any) {
      console.error('SaveMemoryTool error:', error);
      return {
        data: {
          id: '',
          message: ''
        },
        error: `Failed to save memory: ${error.message}`
      };
    }
  }

  mapToolResultToToolResultBlockParam(
    content: SaveMemoryOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || !content.message) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: '(save_memory completed with no output)',
      };
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: content.message,
    };
  }

  isConcurrencySafe(input: SaveMemoryInput): boolean {
    return false; // Memory operations should be sequential
  }

  isReadOnly(input: SaveMemoryInput): boolean {
    return false; // This modifies the memory store
  }

  isDestructive(input: SaveMemoryInput): boolean {
    return false; // Creating memory is not destructive
  }
}

// Export singleton instance
export const saveMemoryTool = new SaveMemoryTool();
