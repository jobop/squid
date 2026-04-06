import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkChannelStatus, getChannelsOverview } from '../channels/channel-overview';
import { ChannelRegistry } from '../channels/registry';
import type { ChannelPlugin } from '../channels/types';

function stubPlugin(
  id: string,
  check: () => Promise<{ healthy: boolean; message?: string }>
): ChannelPlugin {
  return {
    id,
    meta: { name: `Name-${id}`, description: `Desc-${id}`, category: 'builtin' },
    capabilities: {
      outbound: { text: true, media: false, rich: false, streaming: false },
      inbound: { text: false, commands: false, interactive: false },
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
    status: { check },
  };
}

describe('checkChannelStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('status.check 成功时返回健康结果', async () => {
    const r = await checkChannelStatus(
      stubPlugin('x', async () => ({ healthy: true, message: 'ok' })),
      5000
    );
    expect(r.healthy).toBe(true);
    expect(r.message).toBe('ok');
  });

  it('超时时返回不健康', async () => {
    vi.useFakeTimers();
    const p = checkChannelStatus(
      {
        status: {
          check: () =>
            new Promise(() => {
              /* never */
            }),
        },
      },
      80
    );
    await vi.advanceTimersByTimeAsync(80);
    const r = await p;
    expect(r.healthy).toBe(false);
    expect(r.message).toContain('超时');
  });

  it('check 抛错时返回不健康', async () => {
    const r = await checkChannelStatus({
      status: {
        check: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(r.healthy).toBe(false);
    expect(r.message).toBe('boom');
  });
});

describe('getChannelsOverview', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it('已注册插件出现在列表中', async () => {
    registry.register(
      stubPlugin('alpha', async () => ({ healthy: true, message: 'fine' }))
    );
    const list = await getChannelsOverview(registry);
    const row = list.find((c) => c.id === 'alpha');
    expect(row).toBeDefined();
    expect(row!.healthy).toBe(true);
    expect(row!.registered).toBe(true);
    expect(row!.configurable).toBe(false);
    expect(row!.source).toBe('builtin');
  });

  it('extensionPluginIds 中的 id 标记为 extension 来源', async () => {
    registry.register(
      stubPlugin('alpha', async () => ({ healthy: true, message: 'fine' }))
    );
    const list = await getChannelsOverview(registry, new Set(['alpha']));
    expect(list.find((c) => c.id === 'alpha')!.source).toBe('extension');
  });

  it('未注册 feishu 时追加合成行', async () => {
    registry.register(
      stubPlugin('webui', async () => ({ healthy: true, message: 'ws ok' }))
    );
    const list = await getChannelsOverview(registry);
    expect(list.some((c) => c.id === 'feishu')).toBe(true);
    const feishu = list.find((c) => c.id === 'feishu');
    expect(feishu!.registered).toBe(false);
    expect(feishu!.configurable).toBe(true);
    expect(feishu!.source).toBe('builtin');
  });
});
