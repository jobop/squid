import { describe, it, expect, vi } from 'vitest';
import { ChannelRegistry } from '../channels/registry';
import { runExtensionAuthPoll, runExtensionAuthStart } from '../channels/extension-web-auth';
import type { ChannelPlugin } from '../channels/types';
import type { ChannelWebConfigForm } from '../channels/extensions/types';

const minimalForm = (authUi?: ChannelWebConfigForm['authUi']): ChannelWebConfigForm => ({
  userConfigFile: 'test-channel.json',
  fields: [{ key: 'k', label: 'L', type: 'text' }],
  ...(authUi ? { authUi } : {}),
});

function stubPlugin(id: string, webAuth?: ChannelPlugin['extensionWebAuth']): ChannelPlugin {
  return {
    id,
    meta: { name: id, description: '', category: 'third-party' },
    capabilities: {
      outbound: { text: true, media: false, rich: false, streaming: false },
      inbound: { text: true, commands: false, interactive: false },
    },
    config: {
      get: () => undefined,
      set: () => {},
      getAll: () => ({}),
      validate: () => true,
    },
    outbound: {
      sendText: async () => ({ success: true }),
      sendNotification: async () => ({ success: true }),
    },
    status: { check: async () => ({ healthy: true }) },
    ...(webAuth ? { extensionWebAuth: webAuth } : {}),
  };
}

describe('extension-web-auth', () => {
  it('runExtensionAuthStart 拒绝未声明 auth_link 的 form', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const reg = new ChannelRegistry();
    const r = await runExtensionAuthStart({
      channelId: 'x',
      form: minimalForm(),
      registry: reg,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    vi.restoreAllMocks();
  });

  it('runExtensionAuthStart 扩展未加载返回 503', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const reg = new ChannelRegistry();
    const r = await runExtensionAuthStart({
      channelId: 'weixin-personal',
      form: minimalForm({ type: 'auth_link' }),
      registry: reg,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
    vi.restoreAllMocks();
  });

  it('runExtensionAuthStart 调用 extensionWebAuth.startAuthLink', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const reg = new ChannelRegistry();
    reg.register(
      stubPlugin('weixin-personal', {
        startAuthLink: async () => ({
          authUrl: 'https://example.com/auth',
          sessionKey: 'sk1',
        }),
        pollAuthLogin: async () => ({ status: 'pending' }),
      })
    );
    const r = await runExtensionAuthStart({
      channelId: 'weixin-personal',
      form: minimalForm({ type: 'auth_link' }),
      registry: reg,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.authUrl).toContain('example.com');
      expect(r.sessionKey).toBe('sk1');
    }
    vi.restoreAllMocks();
  });

  it('runExtensionAuthPoll 返回插件 poll 结果', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const reg = new ChannelRegistry();
    reg.register(
      stubPlugin('weixin-personal', {
        startAuthLink: async () => ({ authUrl: 'u', sessionKey: 's' }),
        pollAuthLogin: async () => ({ status: 'success', message: 'ok' }),
      })
    );
    const r = await runExtensionAuthPoll({
      channelId: 'weixin-personal',
      sessionKey: 'sk',
      form: minimalForm({ type: 'auth_link' }),
      registry: reg,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('success');
      expect(r.message).toBe('ok');
    }
    vi.restoreAllMocks();
  });
});
