import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type {
  TencentSkillHubInstallOrigin,
  TencentSkillHubInstallStatus,
  TencentSkillHubLockfile,
} from './tencent-skillhub-types';

function getMetadataDir(): string {
  return (
    process.env.SQUID_TENCENT_SKILLHUB_METADATA_DIR ||
    join(homedir(), '.squid', 'skillhub', 'tencent')
  );
}

function getLockfilePath(): string {
  return join(getMetadataDir(), 'lock.json');
}

function getOriginDir(): string {
  return join(getMetadataDir(), 'origins');
}

function safeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(`Invalid skill slug: ${slug}`);
  }
  return normalized;
}

export async function readTencentSkillHubLockfile(): Promise<TencentSkillHubLockfile> {
  try {
    const raw = JSON.parse(await readFile(getLockfilePath(), 'utf-8'));
    if (raw?.version === 1 && raw.skills && typeof raw.skills === 'object') {
      return {
        version: 1,
        skills: raw.skills,
      };
    }
  } catch {
    // ignore
  }
  return {
    version: 1,
    skills: {},
  };
}

export async function writeTencentSkillHubLockfile(lockfile: TencentSkillHubLockfile): Promise<void> {
  await mkdir(getMetadataDir(), { recursive: true });
  await writeFile(getLockfilePath(), `${JSON.stringify(lockfile, null, 2)}\n`, 'utf-8');
}

export async function readTencentSkillHubOrigin(slug: string): Promise<TencentSkillHubInstallOrigin | null> {
  try {
    const file = join(getOriginDir(), `${safeSlug(slug)}.json`);
    const raw = JSON.parse(await readFile(file, 'utf-8'));
    if (
      raw?.version === 1 &&
      typeof raw.registry === 'string' &&
      typeof raw.slug === 'string' &&
      typeof raw.installedVersion === 'string' &&
      typeof raw.installedAt === 'number'
    ) {
      return raw as TencentSkillHubInstallOrigin;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function writeTencentSkillHubOrigin(origin: TencentSkillHubInstallOrigin): Promise<void> {
  await mkdir(getOriginDir(), { recursive: true });
  const file = join(getOriginDir(), `${safeSlug(origin.slug)}.json`);
  await writeFile(file, `${JSON.stringify(origin, null, 2)}\n`, 'utf-8');
}

export function getTencentSkillHubInstallStatus(params: {
  lockfile: TencentSkillHubLockfile;
  slug: string;
  latestVersion: string;
}): {
  status: TencentSkillHubInstallStatus;
  installedVersion?: string;
} {
  const slug = safeSlug(params.slug);
  const record = params.lockfile.skills[slug];
  if (!record) {
    return { status: 'not_installed' };
  }
  if (!params.latestVersion || record.version === params.latestVersion) {
    return {
      status: 'installed',
      installedVersion: record.version,
    };
  }
  return {
    status: 'updatable',
    installedVersion: record.version,
  };
}
