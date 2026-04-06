import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { installTencentSkillHubSkill } from '../skills/tencent-skillhub-installer';
import {
  readTencentSkillHubLockfile,
  readTencentSkillHubOrigin
} from '../skills/tencent-skillhub-metadata';

describe('Tencent SkillHub installer integration', () => {
  let tempRoot = '';
  let skillsDir = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'squid-skillhub-'));
    skillsDir = join(tempRoot, 'skills');
    process.env.SQUID_TENCENT_SKILLHUB_METADATA_DIR = join(tempRoot, 'metadata');
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    delete process.env.SQUID_TENCENT_SKILLHUB_METADATA_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('应完成 列表查询 -> 安装 -> 本地可见 的安装链路', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // index
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          skills: [
            {
              slug: 'demo-skill',
              name: 'Demo Skill',
              latestVersion: '1.0.0'
            }
          ]
        })
      } as any)
      // package
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          files: {
            'SKILL.md': '---\nname: demo-skill\ndescription: demo\nwhen-to-use: demo\nallowed-tools:\n  - bash\neffort: low\nuser-invocable: true\n---\n\ndemo prompt'
          }
        })
      } as any));

    const result = await installTencentSkillHubSkill({
      slug: 'demo-skill',
      config: {
        baseUrl: 'https://example.tencent.skillhub/api/v1',
        indexUrl: 'https://example.tencent.skillhub/skills.json',
        primaryDownloadUrlTemplate: 'https://example.tencent.skillhub/api/v1/download?slug={slug}',
        skillsDir
      }
    });

    expect(result.success).toBe(true);
    expect(result.version).toBe('1.0.0');
    const skillFile = await readFile(join(skillsDir, 'demo-skill', 'SKILL.md'), 'utf-8');
    expect(skillFile).toContain('demo prompt');

    const lock = await readTencentSkillHubLockfile();
    expect(lock.skills['demo-skill']?.version).toBe('1.0.0');
    const origin = await readTencentSkillHubOrigin('demo-skill');
    expect(origin?.installedVersion).toBe('1.0.0');
  });
});
