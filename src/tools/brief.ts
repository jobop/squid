import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const BriefInputSchema = z.object({
  content: z.string().describe('Content to summarize'),
  prompt: z.string().optional().describe('Optional custom prompt'),
  type: z.enum(['brief', 'detailed', 'bullet_points']).optional().describe('Summary type')
});

type BriefInput = z.infer<typeof BriefInputSchema>;

interface BriefOutput {
  success: boolean;
  summary?: string;
  type: string;
  error?: string;
}

export const BriefTool: Tool<typeof BriefInputSchema, BriefOutput> = {
  name: 'brief',
  description: 'Generate summaries with brief, detailed, or bullet-point styles.',
  inputSchema: BriefInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: BriefInput,
    context: ToolContext
  ): Promise<ToolResult<BriefOutput>> {
    const summaryType = input.type || 'brief';

    // Check API key availability.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        data: {
          success: false,
          type: summaryType,
          error: 'ANTHROPIC_API_KEY environment variable is not configured'
        },
        error: 'API key not configured'
      };
    }

    try {
      // Truncate content to keep prompt size in bounds.
      const maxContentLength = 50000;
      let content = input.content;
      if (content.length > maxContentLength) {
        content = content.substring(0, maxContentLength) + '\n\n[Content truncated...]';
      }

      // Build default system prompt by summary type.
      let systemPrompt = '';
      switch (summaryType) {
        case 'brief':
          systemPrompt = 'Summarize the core points below in 2-3 concise sentences.';
          break;
        case 'detailed':
          systemPrompt = 'Provide a detailed summary including key arguments, details, and conclusions.';
          break;
        case 'bullet_points':
          systemPrompt = 'Summarize the content as bullet points, one point per line.';
          break;
      }

      if (input.prompt) {
        systemPrompt = input.prompt;
      }

      // Call Anthropic API.
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\n内容:\n${content}`
          }
        ]
      });

      const summary = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      return {
        data: {
          success: true,
          summary,
          type: summaryType
        }
      };
    } catch (error) {
      return {
        data: {
          success: false,
          type: summaryType,
          error: `Summary generation failed: ${(error as Error).message}`
        },
        error: (error as Error).message
      };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: BriefOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content.success) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: content.error || 'Summary generation failed',
        is_error: true
      };
    }

    let output = `Summary type: ${content.type}\n\n`;
    output += content.summary || '';

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false
};
