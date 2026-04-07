import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WeixinPersonalChannelFileConfig } from './types';

const FILENAME = 'weixin-personal-channel.json';

export function getWeixinPersonalChannelConfigPath(): string {
  return join(homedir(), '.squid', FILENAME);
}

export function getWeixinPersonalSyncBufPath(): string {
  return join(homedir(), '.squid', 'weixin-personal-getupdates.buf');
}

export function validateWeixinPersonalChannelConfig(c: Partial<WeixinPersonalChannelFileConfig>): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!c.botToken?.trim()) errors.push('botToken 不能为空');
  if (!c.baseUrl?.trim()) errors.push('baseUrl 不能为空');
  return { ok: errors.length === 0, errors };
}

export function loadWeixinPersonalChannelConfigSync(): WeixinPersonalChannelFileConfig | null {
  const path = getWeixinPersonalChannelConfigPath();
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as WeixinPersonalChannelFileConfig;
  } catch {
    return null;
  }
}

export function saveWeixinPersonalChannelConfigSync(c: WeixinPersonalChannelFileConfig): void {
  const dir = join(homedir(), '.squid');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getWeixinPersonalChannelConfigPath(), `${JSON.stringify(c, null, 2)}\n`, 'utf8');
}

export function loadGetUpdatesBufSync(): string {
  const p = getWeixinPersonalSyncBufPath();
  try {
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

export function saveGetUpdatesBufSync(buf: string): void {
  const dir = join(homedir(), '.squid');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getWeixinPersonalSyncBufPath(), buf, 'utf8');
}

export function toWeixinPersonalConfigPublicView(
  c: WeixinPersonalChannelFileConfig | null
): Record<string, unknown> {
  if (!c) return {};
  return {
    hasBotToken: Boolean(c.botToken?.trim()),
    baseUrl: c.baseUrl?.trim() ?? '',
    ilinkAccountId: c.ilinkAccountId?.trim() ?? '',
    allowedUserIds: c.allowedUserIds ?? null,
  };
}
