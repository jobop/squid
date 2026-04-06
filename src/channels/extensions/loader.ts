import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventBridge } from '../bridge/event-bridge';
import type { ChannelRegistry } from '../registry';
import type { ChannelPlugin } from '../types';
import {
  loadChannelExtensionsConfigMerged,
  mergeEffectiveExtensionRoots,
} from './config';
import { validateChannelExtensionManifest } from './manifest';
import type { ChannelExtensionLoadError } from './types';

let extensionPluginIds = new Set<string>();
let lastLoadErrors: ChannelExtensionLoadError[] = [];

export function getExtensionChannelPluginIds(): ReadonlySet<string> {
  return extensionPluginIds;
}

export function getChannelExtensionLoadErrors(): readonly ChannelExtensionLoadError[] {
  return lastLoadErrors;
}

function pushError(e: ChannelExtensionLoadError) {
  lastLoadErrors.push(e);
  console.warn('[ChannelExtensions]', e.message, e.path ?? '', e.pluginId ?? '');
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @internal 供单测校验路径关系 */
export function isPathInsideOrEqualChild(realChild: string, realAncestor: string): boolean {
  const a = realAncestor.replace(/[/\\]+$/, '');
  const c = realChild.replace(/[/\\]+$/, '');
  if (c === a) return true;
  const sep = a.includes('\\') ? '\\' : '/';
  return c.startsWith(a + sep);
}

function enabledPredicate(enabled: string[] | null | undefined): (id: string) => boolean {
  if (enabled === undefined || enabled === null) return () => true;
  if (enabled.length === 0) return () => false;
  const allow = new Set(enabled);
  return (id) => allow.has(id);
}

/**
 * 在内置 Channel 注册完成之后调用：从配置的 roots 扫描子目录并动态 import。
 */
export async function loadChannelExtensions(registry: ChannelRegistry): Promise<void> {
  lastLoadErrors = [];
  extensionPluginIds.clear();

  const cfg = loadChannelExtensionsConfigMerged();
  const roots = mergeEffectiveExtensionRoots(cfg);
  if (!roots.length) {
    console.log(
      '[ChannelExtensions] 无可扫描路径：channel-extensions 中 roots 为空且 ~/.squid/extensions 不存在，跳过扩展加载'
    );
    return;
  }

  const reserved = new Set(registry.list().map((p) => p.id));
  const loadedExtensionIds = new Set<string>();
  const allowId = enabledPredicate(cfg.enabled);

  for (const rootRaw of roots) {
    let realRoot: string;
    try {
      realRoot = realpathSync(rootRaw);
    } catch (e: any) {
      pushError({ path: rootRaw, message: `扩展根路径不可用: ${e?.message || e}` });
      continue;
    }
    if (!isDir(realRoot)) {
      pushError({ path: rootRaw, message: '扩展 root 不是目录' });
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(realRoot);
    } catch (e: any) {
      pushError({ path: realRoot, message: `无法读取目录: ${e?.message || e}` });
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
      if (!isPathInsideOrEqualChild(realPluginRoot, realRoot)) {
        pushError({ path: pluginRoot, message: '插件路径越界' });
        continue;
      }

      const manifestPath = join(realPluginRoot, 'channel-plugin.json');
      if (!existsSync(manifestPath)) continue;

      let manifestText: string;
      try {
        manifestText = readFileSync(manifestPath, 'utf8');
      } catch (e: any) {
        pushError({ path: manifestPath, message: `无法读取 manifest: ${e?.message || e}` });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestText);
      } catch {
        pushError({ path: manifestPath, message: 'channel-plugin.json 非合法 JSON' });
        continue;
      }

      const validated = validateChannelExtensionManifest(parsed);
      if (!validated.ok) {
        pushError({ path: manifestPath, message: validated.errors.join('; ') });
        continue;
      }
      const manifest = validated.data;

      if (!allowId(manifest.id)) continue;

      if (reserved.has(manifest.id)) {
        pushError({
          pluginId: manifest.id,
          path: manifestPath,
          message: '扩展 id 与内置 Channel 冲突，已跳过',
        });
        continue;
      }
      if (loadedExtensionIds.has(manifest.id)) {
        pushError({
          pluginId: manifest.id,
          path: manifestPath,
          message: '重复的扩展 id，已跳过',
        });
        continue;
      }

      const mainFsPath = join(realPluginRoot, manifest.main);
      let realMain: string;
      try {
        realMain = realpathSync(mainFsPath);
      } catch (e: any) {
        pushError({
          pluginId: manifest.id,
          path: mainFsPath,
          message: `入口文件不存在: ${e?.message || e}`,
        });
        continue;
      }
      if (!isPathInsideOrEqualChild(realMain, realPluginRoot)) {
        pushError({ pluginId: manifest.id, path: realMain, message: '入口路径越界' });
        continue;
      }

      try {
        const url = pathToFileURL(realMain).href;
        const mod = await import(url);
        const factory = mod.default ?? mod.createChannelPlugin;
        if (typeof factory !== 'function') {
          pushError({
            pluginId: manifest.id,
            path: realMain,
            message: '入口模块须默认导出或命名导出 createChannelPlugin 工厂函数',
          });
          continue;
        }
        const maybe = factory({ eventBridge });
        const plugin: ChannelPlugin = maybe instanceof Promise ? await maybe : maybe;
        if (!plugin?.id || !plugin.meta || !plugin.status || !plugin.outbound || !plugin.config) {
          pushError({
            pluginId: manifest.id,
            path: realMain,
            message: '工厂返回值不是完整的 ChannelPlugin',
          });
          continue;
        }
        if (plugin.id !== manifest.id) {
          pushError({
            pluginId: manifest.id,
            path: realMain,
            message: `实例 id「${plugin.id}」与 manifest id 不一致`,
          });
          continue;
        }

        registry.register(plugin);
        loadedExtensionIds.add(manifest.id);
        extensionPluginIds.add(manifest.id);
        if (plugin.setup?.initialize) {
          await plugin.setup.initialize();
        }
        console.log(`[ChannelExtensions] 已注册扩展: ${plugin.id} (${plugin.meta.name})`);
      } catch (e: any) {
        pushError({
          pluginId: manifest.id,
          path: realMain,
          message: e?.message || String(e),
        });
      }
    }
  }
}
