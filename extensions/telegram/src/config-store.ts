import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TelegramChannelFileConfig } from './types';

const FILENAME = 'telegram-channel.json';

export function getTelegramChannelConfigPath(): string {
  return join(homedir(), '.squid', FILENAME);
}

export function validateTelegramChannelConfig(c: Partial<TelegramChannelFileConfig>): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!c.botToken?.trim()) errors.push('botToken is required');
  return { ok: errors.length === 0, errors };
}

export function loadTelegramChannelConfigSync(): TelegramChannelFileConfig | null {
  const path = getTelegramChannelConfigPath();
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as TelegramChannelFileConfig;
  } catch {
    return null;
  }
}

export function toTelegramConfigPublicView(
  c: TelegramChannelFileConfig | null
): Record<string, unknown> {
  if (!c) return {};
  return {
    hasBotToken: Boolean(c.botToken?.trim()),
    defaultChatId: c.defaultChatId?.trim() ?? '',
    allowedChatIds: c.allowedChatIds ?? null,
    apiBase: c.apiBase?.trim() ?? '',
  };
}
