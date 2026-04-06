import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelExtensionsFileConfig, MergedChannelExtensionsRuntime } from './types';

/**
 * 显式指定 squid 项目根（打包后 bundle 不在源码树内时，或安装路径无向上可解析的 config 时使用）。
 * 须指向含 `config/channel-extensions.json` 的目录。环境变量名：`SQUID_ROOT`。
 */
export const SQUID_ROOT_ENV = 'SQUID_ROOT';

function findRootByChannelExtensionsMarker(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, 'config', 'channel-extensions.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * squid 仓库根（含 `config/channel-extensions.json`，用于解析扩展 roots）。
 * Electrobun 打包后 `import.meta.url` 在 `Resources/app/bun/` 下，不能再用固定 `../../..`；
 * 改为从当前模块路径向上查找配置文件（开发构建通常仍能落到仓库根）。
 */
export function getSquidProjectRoot(): string {
  const env = process.env[SQUID_ROOT_ENV]?.trim();
  if (env && existsSync(join(env, 'config', 'channel-extensions.json'))) {
    return env;
  }

  const fromBundle = findRootByChannelExtensionsMarker(dirname(fileURLToPath(import.meta.url)));
  if (fromBundle) {
    return fromBundle;
  }

  return fileURLToPath(new URL('../../..', import.meta.url));
}

function parseConfigJson(text: string): ChannelExtensionsFileConfig | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as ChannelExtensionsFileConfig;
  } catch {
    return null;
  }
}

function readIfExists(path: string): ChannelExtensionsFileConfig | null {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    return parseConfigJson(text);
  } catch {
    return null;
  }
}

/**
 * 合并项目内与用户目录配置：roots 合并去重；
 * enabled：用户文件含 `enabled` 键时优先生效，否则用项目文件；两侧都未写 `enabled` 键则 enabledExplicit=false（不启用白名单，扫描到的均可加载）。
 */
export function loadChannelExtensionsConfigMerged(): MergedChannelExtensionsRuntime {
  const projectPath = join(getSquidProjectRoot(), 'config', 'channel-extensions.json');
  const userPath = join(homedir(), '.squid', 'channel-extensions.json');

  const project = readIfExists(projectPath);
  const user = readIfExists(userPath);

  const roots = [...new Set([...(project?.roots ?? []), ...(user?.roots ?? [])])];

  let enabled: string[] | undefined;
  let enabledExplicit = false;
  if (user && Object.prototype.hasOwnProperty.call(user, 'enabled')) {
    enabledExplicit = true;
    const v = user.enabled;
    enabled = Array.isArray(v) ? [...v] : [];
  } else if (project && Object.prototype.hasOwnProperty.call(project, 'enabled')) {
    enabledExplicit = true;
    const v = project.enabled;
    enabled = Array.isArray(v) ? [...v] : [];
  }

  return { roots, enabled, enabledExplicit };
}

/**
 * 写入 ~/.squid/channel-extensions.json 的 `enabled` 数组（会合并保留文件中其它键）。
 * 写入后用户侧视为显式白名单。
 */
export function saveUserChannelExtensionsEnabled(enabledIds: string[]): { ok: boolean; error?: string } {
  try {
    const dir = join(homedir(), '.squid');
    mkdirSync(dir, { recursive: true });
    const userPath = join(dir, 'channel-extensions.json');
    let existing: Record<string, unknown> = {};
    if (existsSync(userPath)) {
      try {
        const text = readFileSync(userPath, 'utf8');
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        return { ok: false, error: '~/.squid/channel-extensions.json 非合法 JSON' };
      }
    }
    existing.enabled = [...enabledIds];
    writeFileSync(userPath, JSON.stringify(existing, null, 2), 'utf8');
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** 将 roots 中的相对路径解析为相对于 squid 仓库根的绝对路径 */
export function resolveExtensionRoots(roots: string[]): string[] {
  const base = getSquidProjectRoot();
  return roots.map((r) => (r.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(r) ? r : resolve(base, r)));
}

/** 用户自定义扩展目录（存在则参与扫描，无需写入 channel-extensions.json） */
export function getSquidUserExtensionsRoot(): string {
  return join(homedir(), '.squid', 'extensions');
}

/**
 * 配置中的 roots（已解析）与 `~/.squid/extensions` 合并去重。
 * 用户目录仅在磁盘上已存在时加入，避免缺失目录时每次启动报错。
 * @param existsUserRoot 默认 `existsSync`，单测可注入
 */
export function mergeEffectiveExtensionRoots(
  cfg: ChannelExtensionsFileConfig,
  existsUserRoot: (absPath: string) => boolean = existsSync
): string[] {
  const configured = resolveExtensionRoots(cfg.roots ?? []);
  const userDir = getSquidUserExtensionsRoot();
  const extra = existsUserRoot(userDir) ? [userDir] : [];
  return [...new Set([...configured, ...extra])];
}
