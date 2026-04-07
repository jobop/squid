import { existsSync } from 'node:fs';
import { readFile, readdir } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { homedir } from 'os';
import { getSquidProjectRoot } from '../channels/extensions/config';
import type { SkillDefinition, SkillYAML } from './schema';
import { SkillYAMLSchema } from './schema';

export interface SkillSummary {
  name: string;
  description: string;
  userInvocable: boolean;
  /** 相对 rootDir 的路径 */
  filePath: string;
  /** 技能文件所在根目录（包内 skills 或 ~/.squid/skills） */
  rootDir: string;
}

function resolveBundledSkillsDir(): string | null {
  try {
    const p = join(getSquidProjectRoot(), 'skills');
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

interface MergedSkillEntry {
  rootDir: string;
  filePath: string;
  name: string;
  description: string;
  userInvocable: boolean;
}

export class SkillLoader {
  private readonly userSkillsDir: string;
  private readonly bundledSkillsDir: string | null;

  /**
   * @param skillsDir 若传入，仅扫描该目录（测试用）；否则合并「包内 skills」与 `~/.squid/skills`，同名以用户为准。
   */
  constructor(skillsDir?: string) {
    if (skillsDir !== undefined) {
      this.userSkillsDir = skillsDir;
      this.bundledSkillsDir = null;
    } else {
      this.userSkillsDir = join(homedir(), '.squid', 'skills');
      this.bundledSkillsDir = resolveBundledSkillsDir();
    }
  }

  async loadSkill(filename: string, rootDir?: string): Promise<SkillDefinition> {
    const base = rootDir ?? this.userSkillsDir;
    const filePath = join(base, filename);
    const content = await readFile(filePath, 'utf-8');
    const { metadata, systemPrompt } = this.parseSkillContent(content, filename);

    return {
      metadata,
      systemPrompt
    };
  }

  async loadSkillByName(skillName: string): Promise<SkillDefinition | null> {
    const summaries = await this.listSkillSummaries();
    const normalizedInput = this.normalizeSkillName(skillName);
    const matched = summaries.find((summary) =>
      this.normalizeSkillName(summary.name) === normalizedInput
    );
    if (!matched) {
      return null;
    }
    return this.loadSkill(matched.filePath, matched.rootDir);
  }

  private parseInlineArray(value: string): string[] {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  private parseYAMLValue(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return this.parseInlineArray(trimmed);
    }
    return trimmed.replace(/^['"]|['"]$/g, '');
  }

  private parseYAML(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    let currentArrayKey: string | null = null;

    for (const line of lines) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) {
        continue;
      }

      if (raw.startsWith('-')) {
        if (!currentArrayKey) {
          continue;
        }
        const current = result[currentArrayKey];
        if (!Array.isArray(current)) {
          result[currentArrayKey] = [];
        }
        (result[currentArrayKey] as unknown[]).push(
          this.parseYAMLValue(raw.substring(1).trim())
        );
        continue;
      }

      const separatorIndex = raw.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      const key = raw.slice(0, separatorIndex).trim();
      const value = raw.slice(separatorIndex + 1).trim();
      if (!key) {
        continue;
      }

      if (!value) {
        result[key] = [];
        currentArrayKey = key;
        continue;
      }

      currentArrayKey = null;
      const parsed = this.parseYAMLValue(value);
      result[key] = parsed;

      if (key === 'allowed-tools' && typeof parsed === 'string') {
        result[key] = [parsed];
      }

      if (key === 'allowed_tools') {
        result['allowed-tools'] = Array.isArray(parsed) ? parsed : [String(parsed)];
      }

      if (key === 'when_to_use' && result['when-to-use'] === undefined) {
        result['when-to-use'] = parsed;
      }

      if (key === 'user_invocable' && result['user-invocable'] === undefined) {
        result['user-invocable'] = parsed;
      }
    }

    return result;
  }

  private resolveFallbackSkillName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (basename(normalized).toLowerCase() === 'skill.md') {
      return basename(dirname(normalized));
    }
    return basename(normalized, extname(normalized));
  }

  private extractDescriptionFallback(systemPrompt: string, fallbackName: string): string {
    const firstMeaningfulLine = systemPrompt
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    return firstMeaningfulLine || `${fallbackName} skill`;
  }

  private normalizeMetadata(
    rawMetadata: Record<string, unknown>,
    fallbackName: string,
    systemPrompt: string
  ): SkillYAML {
    const normalized: Record<string, unknown> = { ...rawMetadata };

    if (
      normalized['when-to-use'] === undefined &&
      typeof normalized['when_to_use'] === 'string'
    ) {
      normalized['when-to-use'] = normalized['when_to_use'];
    }

    if (
      normalized['user-invocable'] === undefined &&
      typeof normalized['user_invocable'] === 'boolean'
    ) {
      normalized['user-invocable'] = normalized['user_invocable'];
    }

    if (
      normalized['allowed-tools'] === undefined &&
      normalized['allowed_tools'] !== undefined
    ) {
      normalized['allowed-tools'] = normalized['allowed_tools'];
    }

    if (typeof normalized['allowed-tools'] === 'string') {
      normalized['allowed-tools'] = [normalized['allowed-tools']];
    }

    if (!Array.isArray(normalized['allowed-tools'])) {
      normalized['allowed-tools'] = [];
    }

    if (typeof normalized.name !== 'string' || normalized.name.trim() === '') {
      normalized.name = fallbackName;
    }

    if (
      typeof normalized.description !== 'string' ||
      normalized.description.trim() === ''
    ) {
      normalized.description = this.extractDescriptionFallback(systemPrompt, fallbackName);
    }

    if (normalized['user-invocable'] === undefined) {
      normalized['user-invocable'] = true;
    }

    return SkillYAMLSchema.parse(normalized);
  }

  private parseSkillContent(
    content: string,
    filePath: string
  ): { metadata: SkillYAML; systemPrompt: string } {
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!match) {
      throw new Error('Invalid skill file format');
    }

    const yamlContent = match[1] ?? '';
    const systemPrompt = (match[2] ?? '').trim();
    const fallbackName = this.resolveFallbackSkillName(filePath);
    const metadata = this.normalizeMetadata(
      this.parseYAML(yamlContent),
      fallbackName,
      systemPrompt
    );

    return { metadata, systemPrompt };
  }

  async loadAll(): Promise<Map<string, SkillDefinition>> {
    const skills = new Map<string, SkillDefinition>();
    const entries = await this.collectMergedSkillEntries();

    for (const entry of entries) {
      try {
        const skill = await this.loadSkill(entry.filePath, entry.rootDir);
        skills.set(skill.metadata.name, skill);
      } catch (error) {
        console.warn(
          `[SkillLoader] Skip invalid skill file: ${entry.filePath}`,
          (error as Error).message
        );
      }
    }

    return skills;
  }

  async listSkillSummaries(): Promise<SkillSummary[]> {
    const entries = await this.collectMergedSkillEntries();
    return entries.map((e) => ({
      name: e.name,
      description: e.description,
      userInvocable: e.userInvocable,
      filePath: e.filePath,
      rootDir: e.rootDir,
    }));
  }

  /**
   * 先收录包内 skills，再收录用户目录；按规范化技能名去重，后者覆盖前者。
   */
  private async collectMergedSkillEntries(): Promise<MergedSkillEntry[]> {
    const byNorm = new Map<string, MergedSkillEntry>();

    const scanRoot = async (root: string) => {
      let files: string[];
      try {
        files = await this.collectSkillFiles(root);
      } catch {
        return;
      }
      for (const relativeFile of files) {
        try {
          const content = await readFile(join(root, relativeFile), 'utf-8');
          const { metadata } = this.parseSkillContent(content, relativeFile);
          const key = this.normalizeSkillName(metadata.name);
          byNorm.set(key, {
            rootDir: root,
            filePath: relativeFile,
            name: metadata.name,
            description: metadata.description,
            userInvocable: metadata['user-invocable'],
          });
        } catch (error) {
          console.warn(
            `[SkillLoader] Skip invalid skill file: ${relativeFile}`,
            (error as Error).message
          );
        }
      }
    };

    if (this.bundledSkillsDir) {
      await scanRoot(this.bundledSkillsDir);
    }
    await scanRoot(this.userSkillsDir);

    return Array.from(byNorm.values());
  }

  private normalizeSkillName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '-');
  }

  private async collectSkillFiles(
    dir: string,
    relativeBase: string = ''
  ): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = relativeBase ? join(relativeBase, entry.name) : entry.name;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const nestedFiles = await this.collectSkillFiles(fullPath, relativePath);
        files.push(...nestedFiles);
        continue;
      }

      const lower = entry.name.toLowerCase();
      const isRootMarkdown = relativeBase === '' && lower.endsWith('.md');
      const isSkillEntrypoint = lower === 'skill.md';

      if (isRootMarkdown || isSkillEntrypoint) {
        files.push(relativePath);
      }
    }

    return files;
  }
}
