import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  getSquidProjectRoot,
  getSquidUserExtensionsRoot,
  mergeEffectiveExtensionRoots,
} from '../channels/extensions/config';
import { assertSafeMainEntry, validateChannelExtensionManifest } from '../channels/extensions/manifest';
import { isPathInsideOrEqualChild } from '../channels/extensions/loader';

describe('validateChannelExtensionManifest', () => {
  it('合法 manifest 通过', () => {
    const r = validateChannelExtensionManifest({
      id: 'my-bot',
      name: 'My Bot',
      version: '1.0.0',
      main: './plugin.ts',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe('my-bot');
  });

  it('main 含 .. 拒绝', () => {
    const r = validateChannelExtensionManifest({
      id: 'x',
      name: 'X',
      version: '1',
      main: '../evil.ts',
    });
    expect(r.ok).toBe(false);
  });

  it('缺字段拒绝', () => {
    const r = validateChannelExtensionManifest({ id: 'x' });
    expect(r.ok).toBe(false);
  });

  it('configForm.authUi auth_link 通过', () => {
    const r = validateChannelExtensionManifest({
      id: 'wx',
      name: 'Wx',
      version: '1',
      main: './a.ts',
      configForm: {
        userConfigFile: 'x.json',
        intro: 'i',
        fields: [{ key: 'a', label: 'A', type: 'text' }],
        authUi: { type: 'auth_link', buttonLabel: '获取链接', help: 'h' },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.configForm?.authUi?.type).toBe('auth_link');
  });

  it('configForm.authUi qr_callback 归一化为 auth_link', () => {
    const r = validateChannelExtensionManifest({
      id: 'wx',
      name: 'Wx',
      version: '1',
      main: './a.ts',
      configForm: {
        userConfigFile: 'x.json',
        intro: 'i',
        fields: [{ key: 'a', label: 'A', type: 'text' }],
        authUi: { type: 'qr_callback', buttonLabel: '扫码', help: 'h' },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.configForm?.authUi?.type).toBe('auth_link');
  });

  it('configForm.fields hidden 写入解析结果', () => {
    const r = validateChannelExtensionManifest({
      id: 'wx',
      name: 'Wx',
      version: '1',
      main: './a.ts',
      configForm: {
        userConfigFile: 'x.json',
        fields: [
          { key: 'secretK', label: 'S', type: 'password', secret: true, hidden: true },
          { key: 'vis', label: 'V', type: 'text' },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const fields = r.data.configForm?.fields;
      expect(fields?.[0].hidden).toBe(true);
      expect(fields?.[1].hidden).toBeUndefined();
    }
  });

  it('configForm.authUi.type 非法拒绝', () => {
    const r = validateChannelExtensionManifest({
      id: 'wx',
      name: 'Wx',
      version: '1',
      main: './a.ts',
      configForm: {
        userConfigFile: 'x.json',
        fields: [{ key: 'a', label: 'A', type: 'text' }],
        authUi: { type: 'unknown' },
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe('assertSafeMainEntry', () => {
  it('拒绝绝对路径', () => {
    expect(assertSafeMainEntry('/tmp/x.ts')).toBeNull();
  });
});

describe('isPathInsideOrEqualChild', () => {
  it('同级子路径通过', () => {
    expect(isPathInsideOrEqualChild('/a/b/c', '/a/b')).toBe(true);
  });

  it('兄弟目录拒绝', () => {
    expect(isPathInsideOrEqualChild('/a/c', '/a/b')).toBe(false);
  });
});

describe('getSquidProjectRoot', () => {
  it('向上解析到含 config/channel-extensions.json 的仓库根（打包后路径也能落到开发树）', () => {
    const root = getSquidProjectRoot();
    expect(existsSync(join(root, 'config', 'channel-extensions.json'))).toBe(true);
    expect(existsSync(join(root, 'extensions', 'feishu', 'channel-plugin.json'))).toBe(true);
  });
});

describe('mergeEffectiveExtensionRoots', () => {
  it('~/.squid/extensions 存在时并入根列表', () => {
    const userRoot = join(homedir(), '.squid', 'extensions');
    expect(getSquidUserExtensionsRoot()).toBe(userRoot);
    const roots = mergeEffectiveExtensionRoots({ roots: [] }, (p) => p === userRoot);
    expect(roots).toContain(userRoot);
  });

  it('用户扩展目录不存在且配置 roots 为空时不产生根路径', () => {
    const roots = mergeEffectiveExtensionRoots({ roots: [] }, () => false);
    expect(roots).toEqual([]);
  });
});
