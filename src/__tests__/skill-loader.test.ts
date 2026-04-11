import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillLoader } from '../skills/loader';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

describe('SkillLoader', () => {
  const testDir = '/tmp/test-skills';
  let loader: SkillLoader;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    loader = new SkillLoader(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should load skill from markdown file', async () => {
    const skillContent = `---
name: test-skill
description: Test skill
when-to-use: For testing
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Test system prompt`;

    await writeFile(join(testDir, 'test-skill.md'), skillContent);
    const skill = await loader.loadSkill('test-skill.md');

    expect(skill.metadata.name).toBe('test-skill');
    expect(skill.metadata.description).toBe('Test skill');
    expect(skill.systemPrompt).toBe('Test system prompt');
    expect(skill.metadata['allowed-tools']).toContain('read_file');
  });

  it('should throw error for invalid format', async () => {
    await writeFile(join(testDir, 'invalid.md'), 'No frontmatter');
    await expect(loader.loadSkill('invalid.md')).rejects.toThrow();
  });

  it('should load nested SKILL.md installed from marketplace', async () => {
    const skillContent = `---
name: marketplace-skill
description: Marketplace skill
when-to-use: For marketplace
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Marketplace prompt`;

    await mkdir(join(testDir, 'marketplace-skill'), { recursive: true });
    await writeFile(join(testDir, 'marketplace-skill', 'SKILL.md'), skillContent);

    const all = await loader.loadAll();
    expect(all.has('marketplace-skill')).toBe(true);
    expect(all.get('marketplace-skill')?.systemPrompt).toBe('Marketplace prompt');
  });

  it('should list skill summaries without loading body usage logic', async () => {
    const skillContent = `---
name: summary-skill
description: Summary visible
when-to-use: Summary test
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Body should be loaded on demand.`;

    await writeFile(join(testDir, 'summary-skill.md'), skillContent);
    const summaries = await loader.listSkillSummaries();
    const found = summaries.find((s) => s.name === 'summary-skill');
    expect(found).toBeTruthy();
    expect(found?.description).toBe('Summary visible');
    expect(found?.userInvocable).toBe(true);
  });

  it('should load skill by normalized name', async () => {
    const skillContent = `---
name: creator-alpha-feed
description: Alias match
when-to-use: alias
allowed-tools:
  - read_file
effort: low
user-invocable: true
---

Alias body`;

    await writeFile(join(testDir, 'creator-alpha-feed.md'), skillContent);
    const matched = await loader.loadSkillByName('creator_alpha_feed');
    expect(matched).not.toBeNull();
    expect(matched?.metadata.name).toBe('creator-alpha-feed');
    expect(matched?.systemPrompt).toBe('Alias body');
  });

  it('should parse inline allowed-tools arrays', async () => {
    const skillContent = `---
name: inline-tools-skill
description: Inline tools format
allowed-tools: [bash, read_file]
user-invocable: true
---

Inline body`;

    await writeFile(join(testDir, 'inline-tools-skill.md'), skillContent);
    const skill = await loader.loadSkill('inline-tools-skill.md');
    expect(skill.metadata['allowed-tools']).toEqual(['bash', 'read_file']);
  });

  it('should fallback defaults when optional fields are missing', async () => {
    const skillContent = `---
allowed-tools: [read_file]
---

Fallback description line.`;

    await writeFile(join(testDir, 'fallback-skill.md'), skillContent);
    const summary = (await loader.listSkillSummaries()).find((s) => s.filePath === 'fallback-skill.md');
    expect(summary).toBeTruthy();
    expect(summary?.rootDir).toBe(testDir);
    expect(summary?.name).toBe('fallback-skill');
    expect(summary?.description).toContain('Fallback description line');
    expect(summary?.userInvocable).toBe(true);
  });

  it('should scan workspace skills directory when workspace is provided', async () => {
    const skillContent = `---
name: workspace-skill-only
description: From workspace skills directory
when-to-use: workspace only
allowed-tools:
  - read_file
user-invocable: true
---

Workspace skill body`;

    await mkdir(join(testDir, 'skills', 'workspace-skill-only'), { recursive: true });
    await writeFile(
      join(testDir, 'skills', 'workspace-skill-only', 'SKILL.md'),
      skillContent
    );

    const workspaceLoader = new SkillLoader(undefined, testDir);
    const summaries = await workspaceLoader.listSkillSummaries();
    const found = summaries.find((s) => s.name === 'workspace-skill-only');
    expect(found).toBeTruthy();
    expect(found?.description).toBe('From workspace skills directory');
  });
});
