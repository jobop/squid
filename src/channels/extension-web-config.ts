/**
 * 扩展在 channel-plugin.json 中声明 configForm 后，由宿主提供通用读写与渠道页动态表单（无需每渠道手写 API）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { realpathSync, readdirSync } from 'node:fs';
import {
  loadChannelExtensionsConfigMerged,
  mergeEffectiveExtensionRoots,
} from './extensions/config';
import { validateChannelExtensionManifest } from './extensions/manifest';
import { isPathInsideOrEqualChild } from './extensions/loader';
import type { ChannelWebConfigForm } from './extensions/types';

const RESERVED = new Set(['webui']);
const SAFE_USER_CONFIG = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function secretPresenceKey(fieldKey: string): string {
  return `has${fieldKey.charAt(0).toUpperCase()}${fieldKey.slice(1)}`;
}

/** 扫描磁盘：带 Web 配置表单的扩展 id（与是否已加载无关） */
export function getExtensionWebConfigurableChannelIds(): Set<string> {
  const forms = scanExtensionConfigForms();
  return new Set(forms.keys());
}

function scanExtensionConfigForms(): Map<string, ChannelWebConfigForm> {
  const cfg = loadChannelExtensionsConfigMerged();
  const roots = mergeEffectiveExtensionRoots({ roots: cfg.roots });
  const byId = new Map<string, ChannelWebConfigForm>();
  if (!roots.length) return byId;

  for (const rootRaw of roots) {
    let realRoot: string;
    try {
      realRoot = realpathSync(rootRaw);
    } catch {
      continue;
    }
    if (!isDir(realRoot)) continue;

    let entries: string[];
    try {
      entries = readdirSync(realRoot);
    } catch {
      continue;
    }

    for (const name of entries) {
      const pluginRoot = join(realRoot, name);
      if (!isDir(pluginRoot)) continue;
      let realPluginRoot: string;
      try {
        realPluginRoot = realpathSync(pluginRoot);
      } catch {
        continue;
      }
      if (!isPathInsideOrEqualChild(realPluginRoot, realRoot)) continue;

      const manifestPath = join(realPluginRoot, 'channel-plugin.json');
      if (!existsSync(manifestPath)) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }

      const validated = validateChannelExtensionManifest(parsed);
      if (!validated.ok) continue;
      const form = validated.data.configForm;
      if (!form) continue;
      const m = validated.data;
      if (RESERVED.has(m.id)) continue;
      if (byId.has(m.id)) continue;
      byId.set(m.id, form);
    }
  }

  return byId;
}

export function findExtensionWebConfigForm(channelId: string): ChannelWebConfigForm | null {
  return scanExtensionConfigForms().get(channelId) ?? null;
}

function squidUserConfigPath(userConfigFile: string): string {
  const base = basename(userConfigFile);
  if (base !== userConfigFile || !SAFE_USER_CONFIG.test(base)) {
    throw new Error('非法 userConfigFile');
  }
  return join(homedir(), '.squid', base);
}

export async function readUserConfigJson(userConfigFile: string): Promise<Record<string, unknown>> {
  const path = squidUserConfigPath(userConfigFile);
  try {
    const raw = await readFile(path, 'utf8');
    const o = JSON.parse(raw) as unknown;
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildPublicValuesForForm(
  form: ChannelWebConfigForm,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form.fields) {
    if (f.hidden) {
      continue;
    }
    if (f.secret) {
      const v = raw[f.key];
      const s = typeof v === 'string' ? v : v != null ? String(v) : '';
      out[secretPresenceKey(f.key)] = Boolean(s.trim());
      continue;
    }
    const v = raw[f.key];
    if (f.type === 'json') {
      if (v === undefined || v === null) {
        out[f.key] = '';
      } else {
        try {
          out[f.key] = JSON.stringify(v, null, 2);
        } catch {
          out[f.key] = String(v);
        }
      }
      continue;
    }
    if (v === undefined || v === null) {
      out[f.key] = '';
    } else if (typeof v === 'string') {
      out[f.key] = v;
    } else {
      out[f.key] = String(v);
    }
  }
  return out;
}

async function validateMergedConfig(
  channelId: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; errors: string[] }> {
  if (channelId === 'telegram') {
    const { validateTelegramChannelConfig } = await import('../../extensions/telegram/src/config-store');
    return validateTelegramChannelConfig(data as Record<string, string>);
  }
  if (channelId === 'feishu') {
    const { validateFeishuChannelConfig } = await import('../../extensions/feishu/src/config-store');
    type F = import('../../extensions/feishu/src/types').FeishuChannelFileConfig;
    return validateFeishuChannelConfig(data as Partial<F>);
  }
  if (channelId === 'weixin-personal') {
    const { validateWeixinPersonalChannelConfig } = await import(
      '../../extensions/weixin-personal/src/config-store'
    );
    type W = import('../../extensions/weixin-personal/src/types').WeixinPersonalChannelFileConfig;
    const w = data as Partial<W>;
    if (!w.botToken?.trim() && !w.baseUrl?.trim()) {
      return { ok: true, errors: [] };
    }
    return validateWeixinPersonalChannelConfig(w);
  }
  return { ok: true, errors: [] };
}

export async function saveExtensionWebConfig(
  channelId: string,
  form: ChannelWebConfigForm,
  rawValues: Record<string, string>
): Promise<{ ok: boolean; errors?: string[] }> {
  const path = squidUserConfigPath(form.userConfigFile);
  let prev: Record<string, unknown> = {};
  try {
    if (existsSync(path)) {
      const raw = await readFile(path, 'utf8');
      const o = JSON.parse(raw) as unknown;
      if (typeof o === 'object' && o !== null && !Array.isArray(o)) {
        prev = o as Record<string, unknown>;
      }
    }
  } catch {
    prev = {};
  }

  const next: Record<string, unknown> = { ...prev };

  for (const f of form.fields) {
    if (f.hidden) {
      continue;
    }
    const incoming = rawValues[f.key];
    const trimmed = incoming !== undefined && incoming !== null ? String(incoming).trim() : '';

    // 含敏感接收方 ID 等：与 password 一样，留空不覆盖磁盘已有值
    if (f.secret && f.type !== 'json') {
      if (!trimmed) continue;
      next[f.key] = trimmed;
      continue;
    }

    if (f.type === 'json') {
      if (!trimmed) {
        delete next[f.key];
        continue;
      }
      try {
        next[f.key] = JSON.parse(trimmed) as unknown;
      } catch {
        return { ok: false, errors: [`${f.label}（${f.key}）不是合法 JSON`] };
      }
      continue;
    }

    if (!trimmed) {
      if (f.optional) {
        delete next[f.key];
      } else {
        next[f.key] = '';
      }
      continue;
    }
    next[f.key] = trimmed;
  }

  const v = await validateMergedConfig(channelId, next);
  if (!v.ok) {
    return { ok: false, errors: v.errors };
  }

  await mkdir(join(homedir(), '.squid'), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
  return { ok: true };
}
