import { basename } from 'node:path';
import type {
  ChannelExtensionManifest,
  ChannelWebConfigAuthUi,
  ChannelWebConfigField,
  ChannelWebConfigForm,
} from './types';

const SAFE_CONFIG_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/;
const FIELD_TYPES = new Set(['text', 'password', 'textarea', 'select', 'json']);

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

  if (o.configForm !== undefined) {
    const parsed = parseConfigForm(o.configForm, errors);
    if (parsed) {
      data.configForm = parsed;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, data };
}

function parseConfigForm(
  raw: unknown,
  errors: string[]
): ChannelWebConfigForm | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('configForm 须为对象');
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  const fn = typeof c.userConfigFile === 'string' ? c.userConfigFile.trim() : '';
  if (!fn || !SAFE_CONFIG_FILENAME.test(fn) || basename(fn) !== fn) {
    errors.push('configForm.userConfigFile 须为安全的 .json 文件名（无路径）');
  }
  if (!Array.isArray(c.fields) || c.fields.length === 0) {
    errors.push('configForm.fields 须为非空数组');
    return undefined;
  }

  const fields: ChannelWebConfigField[] = [];
  let i = 0;
  for (const item of c.fields) {
    i++;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`configForm.fields[${i}] 须为对象`);
      continue;
    }
    const f = item as Record<string, unknown>;
    if (!isNonEmptyString(f.key) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(f.key).trim())) {
      errors.push(`configForm.fields[${i}].key 须为合法标识符`);
      continue;
    }
    if (!isNonEmptyString(f.label)) {
      errors.push(`configForm.fields[${i}].label 须为非空字符串`);
      continue;
    }
    const t = typeof f.type === 'string' ? f.type.trim() : '';
    if (!FIELD_TYPES.has(t)) {
      errors.push(`configForm.fields[${i}].type 非法`);
      continue;
    }
    const field: ChannelWebConfigField = {
      key: String(f.key).trim(),
      label: String(f.label).trim(),
      type: t as ChannelWebConfigField['type'],
    };
    if (f.hidden === true) field.hidden = true;
    if (f.optional === true) field.optional = true;
    if (f.secret === true) field.secret = true;
    if (typeof f.placeholder === 'string' && f.placeholder.trim()) {
      field.placeholder = f.placeholder.trim();
    }
    if (t === 'select') {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        errors.push(`configForm.fields[${i}] select 须含 options`);
        continue;
      }
      const opts: { value: string; label: string }[] = [];
      for (const op of f.options) {
        if (op === null || typeof op !== 'object') continue;
        const o = op as Record<string, unknown>;
        if (typeof o.value === 'string' && typeof o.label === 'string') {
          opts.push({ value: o.value, label: o.label });
        }
      }
      if (!opts.length) {
        errors.push(`configForm.fields[${i}] options 无效`);
        continue;
      }
      field.options = opts;
    }
    fields.push(field);
  }

  if (errors.length) return undefined;
  if (fields.length !== (c.fields as unknown[]).length) {
    errors.push('configForm.fields 存在未解析项');
    return undefined;
  }

  let authUi: ChannelWebConfigAuthUi | undefined;
  if (c.authUi !== undefined) {
    if (c.authUi === null || typeof c.authUi !== 'object' || Array.isArray(c.authUi)) {
      errors.push('configForm.authUi 须为对象');
    } else {
      const a = c.authUi as Record<string, unknown>;
      const typ = typeof a.type === 'string' ? a.type.trim() : '';
      const normalizedType =
        typ === 'auth_link' || typ === 'qr_callback' ? 'auth_link' : null;
      if (!normalizedType) {
        errors.push(
          'configForm.authUi.type 暂仅支持 auth_link（qr_callback 已弃用，仍兼容并会归一为 auth_link）'
        );
      } else {
        const au: ChannelWebConfigAuthUi = { type: 'auth_link' };
        if (typeof a.buttonLabel === 'string' && a.buttonLabel.trim()) {
          au.buttonLabel = a.buttonLabel.trim();
        }
        if (typeof a.help === 'string' && a.help.trim()) {
          au.help = a.help.trim();
        }
        authUi = au;
      }
    }
  }

  if (errors.length) return undefined;

  const intro = typeof c.intro === 'string' && c.intro.trim() ? c.intro.trim() : undefined;
  return {
    userConfigFile: fn,
    intro,
    fields,
    ...(authUi ? { authUi } : {}),
  };
}
