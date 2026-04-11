/**
 * Channel extensions are dynamically imported inside the app package from
 * Resources/app/extensions/.../src/*.ts. Their npm dependencies must exist
 * under Resources/app/node_modules (separate from the main process bundle).
 * Starting from real extension seed packages, BFS-copy dependencies and
 * optionalDependencies declared in package.json.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const nmRoot = join(projectRoot, 'node_modules');
const outRoot = join(projectRoot, 'build', 'extension-node_modules');

function depPathSegments(dep: string): string[] {
  if (dep.startsWith('@')) {
    const i = dep.indexOf('/');
    if (i === -1) return [dep];
    return [dep.slice(0, i), dep.slice(i + 1)];
  }
  return [dep];
}

function resolvePackage(fromPackageDir: string, depName: string): string | null {
  const segments = depPathSegments(depName);
  let dir = fromPackageDir;
  for (let i = 0; i < 60; i++) {
    const candidate = join(dir, 'node_modules', ...segments);
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const rootCand = join(nmRoot, ...segments);
  if (existsSync(join(rootCand, 'package.json'))) {
    return rootCand;
  }
  return null;
}

function readProdDepNames(pkgDir: string): string[] {
  const pj = join(pkgDir, 'package.json');
  if (!existsSync(pj)) return [];
  const json = JSON.parse(readFileSync(pj, 'utf8')) as Record<string, unknown>;
  const d = json.dependencies as Record<string, string> | undefined;
  const o = json.optionalDependencies as Record<string, string> | undefined;
  return [...Object.keys(d ?? {}), ...Object.keys(o ?? {})];
}

/** Keep aligned with real `from 'pkg'` usage in extensions; add new seeds here. */
const SEEDS = ['@larksuiteoapi/node-sdk', 'axios'];

function safeRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

function main(): void {
  mkdirSync(outRoot, { recursive: true });

  const feishuSrc = join(projectRoot, 'extensions', 'feishu', 'src');
  const queue: string[] = [];
  for (const seed of SEEDS) {
    const p = resolvePackage(feishuSrc, seed) ?? resolvePackage(projectRoot, seed);
    if (!p) {
      console.error('[copy-extension-npm-deps] Seed package not found:', seed);
      process.exit(1);
    }
    queue.push(p);
  }

  const visitedReal = new Set<string>();

  while (queue.length > 0) {
    const pkgDir = queue.shift()!;
    if (!existsSync(join(pkgDir, 'package.json'))) continue;

    const rp = safeRealpath(pkgDir);
    if (visitedReal.has(rp)) continue;
    visitedReal.add(rp);

    const relFromNm = relative(nmRoot, rp);
    if (relFromNm.startsWith('..') || relFromNm === '') {
      console.warn('[copy-extension-npm-deps] Skipped (not under node_modules):', rp);
      continue;
    }

    const dest = join(outRoot, relFromNm);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(rp, dest, { recursive: true, dereference: true });

    for (const dep of readProdDepNames(rp)) {
      const next = resolvePackage(rp, dep);
      if (next) {
        const nr = safeRealpath(next);
        if (!visitedReal.has(nr)) queue.push(next);
      }
    }
  }

  console.log(
    '[copy-extension-npm-deps] copied to',
    outRoot,
    '(package directories:',
    visitedReal.size,
    ')'
  );
}

main();
