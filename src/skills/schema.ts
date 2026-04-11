import { z } from 'zod';

export const SkillYAMLSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  'when-to-use': z.string().optional(),
  'allowed-tools': z.array(z.string()).default([]),
  'argument-hint': z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  'user-invocable': z.boolean().default(true),
  hooks: z.object({
    pre_invoke: z.string().optional(),
    post_invoke: z.string().optional()
  }).optional(),
  examples: z.array(z.string()).optional()
});

export type SkillYAML = z.infer<typeof SkillYAMLSchema>;

export interface SkillDefinition {
  metadata: SkillYAML;
  systemPrompt: string;
  skillRoot?: string;
}
