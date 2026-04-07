import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  looksLikeDotEncodedAbsolutePath,
  resolveSafeWorkspacePath,
  tryRecoverDotEncodedRelativePath,
} from '../workspace-path';

describe('workspace-path', () => {
  it('looksLikeDotEncodedAbsolutePath 识别误写的 Users 点号路径', () => {
    expect(
      looksLikeDotEncodedAbsolutePath(
        '.Users.myidd007.Documents.testclauld.test2.test3.test4.hello.all'
      )
    ).toBe(true);
    expect(looksLikeDotEncodedAbsolutePath('.Users.foo.bar.baz.txt')).toBe(true);
    expect(looksLikeDotEncodedAbsolutePath('.Volumes.Data.x')).toBe(true);
  });

  it('合法相对路径不误判', () => {
    expect(looksLikeDotEncodedAbsolutePath('hello.all')).toBe(false);
    expect(looksLikeDotEncodedAbsolutePath('.squid/plan.md')).toBe(false);
    expect(looksLikeDotEncodedAbsolutePath('src/foo.ts')).toBe(false);
    expect(looksLikeDotEncodedAbsolutePath('.env.local')).toBe(false);
    expect(looksLikeDotEncodedAbsolutePath('pkg\\mod\\x.go')).toBe(false);
  });

  it('Windows 风格点号误写', () => {
    expect(looksLikeDotEncodedAbsolutePath('.C.Users.me.Documents.out.txt')).toBe(true);
    expect(looksLikeDotEncodedAbsolutePath('C.Users.me.Documents.proj.file.txt')).toBe(true);
  });

  it('tryRecoverDotEncodedRelativePath 从误写中提取 hello.py', () => {
    expect(
      tryRecoverDotEncodedRelativePath(
        '.Users.myidd007.Documents.testclauld.test2.test3.test4.hello.py'
      )
    ).toBe('hello.py');
  });

  it('resolveSafeWorkspacePath 对可恢复误写解析为工作区内文件', async () => {
    const ws = path.resolve('/tmp/squid-ws-path-test');
    const r = await resolveSafeWorkspacePath(
      ws,
      '.Users.x.y.Documents.proj.test4.hello.py'
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.abs).toBe(path.resolve(ws, 'hello.py'));
    }
  });

  it('resolveSafeWorkspacePath 无法恢复的点号链仍拒绝', async () => {
    const ws = path.resolve('/tmp/squid-ws-path-test');
    const r = await resolveSafeWorkspacePath(ws, '.Users.x.y.z.unknownext');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('相对工作区');
    }
  });
});
