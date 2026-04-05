import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FeishuChannelFileConfig } from './types';

const FILENAME = 'feishu-channel.json';

export function getFeishuChannelConfigPath(): string {
  return join(homedir(), '.squid', FILENAME);
}

export function maskSecret(value: string | undefined, visibleTail = 4): string {
  if (!value?.trim()) return '';
  if (value.length <= visibleTail) return '***';
  return `***${value.slice(-visibleTail)}`;
}

export function validateFeishuChannelConfig(c: Partial<FeishuChannelFileConfig>): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!c.appId?.trim()) errors.push('appId 不能为空');
  if (!c.appSecret?.trim()) errors.push('appSecret 不能为空');
  return { ok: errors.length === 0, errors };
}

export function validateFeishuOutboundConfig(c: Partial<FeishuChannelFileConfig>): {
  ok: boolean;
  errors: string[];
} {
  const base = validateFeishuChannelConfig(c);
  const errors = [...base.errors];
  if (!c.defaultReceiveId?.trim()) errors.push('defaultReceiveId 不能为空（出站需要 chat_id 等）');
  if (!c.defaultReceiveIdType) errors.push('defaultReceiveIdType 不能为空');
  return { ok: errors.length === 0, errors };
}

export async function loadFeishuChannelConfig(): Promise<FeishuChannelFileConfig | null> {
  const path = getFeishuChannelConfigPath();
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as FeishuChannelFileConfig;
    return data;
  } catch {
    return null;
  }
}

export function loadFeishuChannelConfigSync(): FeishuChannelFileConfig | null {
  const path = getFeishuChannelConfigPath();
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as FeishuChannelFileConfig;
  } catch {
    return null;
  }
}

export async function saveFeishuChannelConfig(
  partial: Partial<FeishuChannelFileConfig>
): Promise<{ ok: boolean; errors?: string[] }> {
  const dir = join(homedir(), '.squid');
  await mkdir(dir, { recursive: true });
  const path = getFeishuChannelConfigPath();
  const prev = (await loadFeishuChannelConfig()) ?? ({} as FeishuChannelFileConfig);
  const next: FeishuChannelFileConfig = {
    ...prev,
    ...partial,
    appId: partial.appId !== undefined ? String(partial.appId) : prev.appId,
    appSecret: partial.appSecret !== undefined ? String(partial.appSecret) : prev.appSecret,
  };
  if (partial.encryptKey !== undefined) {
    next.encryptKey = partial.encryptKey ? String(partial.encryptKey) : undefined;
  }
  if (partial.verificationToken !== undefined) {
    next.verificationToken = partial.verificationToken
      ? String(partial.verificationToken)
      : undefined;
  }
  if (partial.defaultReceiveId !== undefined) {
    next.defaultReceiveId = partial.defaultReceiveId
      ? String(partial.defaultReceiveId)
      : undefined;
  }
  if (partial.defaultReceiveIdType !== undefined) {
    next.defaultReceiveIdType = partial.defaultReceiveIdType;
  }
  if (partial.connectionMode !== undefined) {
    next.connectionMode = partial.connectionMode;
  }
  if (partial.feishuDomain !== undefined) {
    next.feishuDomain = partial.feishuDomain;
  }
  const { ok, errors } = validateFeishuChannelConfig(next);
  if (!ok) return { ok: false, errors };
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
  return { ok: true };
}

/** API 响应用：绝不返回完整 appSecret / encryptKey */
export function toFeishuConfigPublicView(c: FeishuChannelFileConfig | null): Record<string, unknown> {
  if (!c) {
    return {
      configured: false,
      appId: '',
      hasAppSecret: false,
      hasEncryptKey: false,
      connectionMode: 'websocket',
      feishuDomain: 'feishu',
      defaultReceiveIdType: 'chat_id',
      defaultReceiveIdSet: false,
    };
  }
  return {
    configured: true,
    appId: c.appId,
    hasAppSecret: Boolean(c.appSecret?.trim()),
    hasEncryptKey: Boolean(c.encryptKey?.trim()),
    appSecretPreview: maskSecret(c.appSecret),
    encryptKeyPreview: maskSecret(c.encryptKey),
    connectionMode: c.connectionMode ?? 'websocket',
    feishuDomain: c.feishuDomain ?? 'feishu',
    defaultReceiveIdType: c.defaultReceiveIdType ?? 'chat_id',
    defaultReceiveIdSet: Boolean(c.defaultReceiveId?.trim()),
  };
}
