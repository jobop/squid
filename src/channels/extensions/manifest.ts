import type { ChannelExtensionManifest } from './types';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** main 须为相对路径且不含 .. */
export function assertSafeMainEntry(main: string): string | null {
  const t = main.trim();
  if (!t || t.startsWith('/') || /^[a-z]+:/i.test(t)) return null;
  const norm = t.replace(/\\/g, '/');
  if (norm.split('/').some((p) => p === '..')) return null;
  return t;
}

export function validateChannelExtensionManifest(raw: unknown): { ok: true; data: ChannelExtensionManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest 须为 JSON 对象'] };
  }
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) errors.push('id 须为非空字符串');
  if (!isNonEmptyString(o.name)) errors.push('name 须为非空字符串');
  if (!isNonEmptyString(o.version)) errors.push('version 须为非空字符串');
  if (!isNonEmptyString(o.main)) errors.push('main 须为非空字符串');
  else {
    const safe = assertSafeMainEntry(o.main);
    if (!safe) errors.push('main 须为相对路径且不得包含 .. 或绝对路径');
  }
  if (errors.length) return { ok: false, errors };

  const data: ChannelExtensionManifest = {
    id: String(o.id).trim(),
    name: String(o.name).trim(),
    version: String(o.version).trim(),
    main: assertSafeMainEntry(String(o.main))!,
  };
  if (o.capabilities !== undefined && typeof o.capabilities === 'object' && !Array.isArray(o.capabilities)) {
    data.capabilities = o.capabilities as ChannelExtensionManifest['capabilities'];
  }
  if (o.permissions !== undefined && Array.isArray(o.permissions)) {
    data.permissions = o.permissions.filter((x) => typeof x === 'string') as string[];
  }
  return { ok: true, data };
}
