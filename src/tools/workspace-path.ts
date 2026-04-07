import path from 'path';
import { realpath } from 'fs/promises';
import { isPathInsideWorkspace } from '../tasks/plan-mode-policy';

const DOT_ENCODED_PATH_HINT =
  'file_path 须为相对工作区的正常路径（如 hello.all、src/a.ts），不要把绝对路径里的 / 或 \\ 换成点号链。';

/**
 * 检测模型把「本机绝对路径」误写成「无分隔符的点号链」的相对路径（在各 OS 上都会落到 workDir 下错误位置）。
 *
 * - **解析与越界校验**（resolveSafeWorkspacePath 内）使用 Node `path`/`realpath`，随**当前进程所在系统**处理 `/` 与 `\\`，对 mac / win / linux 通用。
 * - **本函数**是启发式：覆盖常见误写（macOS `.Users.`、`.Volumes.`；Linux `.home.`；Windows 把 `C:\\Users\\...` 写成 `.C.Users...` 或 `C.Users...`）。
 */
export function looksLikeDotEncodedAbsolutePath(filePath: string): boolean {
  const t = filePath.trim();
  if (!t) return false;

  // macOS
  if (/^\.Users\./i.test(t)) return true;
  if (/^\.Volumes\./i.test(t)) return true;
  // Linux /home/... 误写
  if (/^\.home\./i.test(t)) return true;
  // Windows：常见为 C:\Users\... → .C.Users... 或 C.Users...（无盘符后的冒号与反斜杠）
  if (/^\.[A-Za-z]\.Users\./i.test(t)) return true;
  const dotSegs = t.split('.').filter(Boolean);
  if (/^[A-Za-z]\.Users\./i.test(t) && dotSegs.length >= 4) return true;

  // 无任何路径分隔符、但段数很多且含 .users.，多为误编码绝对路径
  if (!t.includes('/') && !t.includes('\\')) {
    const lower = t.toLowerCase();
    if (lower.includes('.users.') && lower.split('.').length >= 6) return true;
  }

  return false;
}

/** 允许从点号误写路径末尾恢复的扩展名（仅单层文件名，如 hello.py） */
const RECOVER_EXT =
  '(?:py|js|go|jsx|tsx|ts|mjs|cjs|md|json|txt|all|yaml|yml|toml|rs|java|kt|swift|cs|cpp|c|h)';

/**
 * 从 `.Users....hello.py` 这类误写中尽量取出末尾「单层」相对文件名（保守，避免误伤带多点的合法名）。
 */
export function tryRecoverDotEncodedRelativePath(filePath: string): string | null {
  if (!looksLikeDotEncodedAbsolutePath(filePath)) return null;
  const t = filePath.trim();
  const m = t.match(
    new RegExp(`\\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,120}\\.${RECOVER_EXT})$`, 'i')
  );
  return m ? m[1] : null;
}

/**
 * 将 file_path 解析为工作区内的绝对路径，并校验不越出 workspace（含符号链接解析后的根）。
 * 新文件尚不存在时，用其父目录的 realpath + basename 参与校验。
 */
export async function resolveSafeWorkspacePath(
  workDir: string,
  filePath: string
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  let trimmed = filePath.trim();
  if (!trimmed) {
    return { ok: false, error: 'file_path 不能为空' };
  }

  if (looksLikeDotEncodedAbsolutePath(trimmed)) {
    const recovered = tryRecoverDotEncodedRelativePath(trimmed);
    if (recovered) {
      trimmed = recovered;
    } else {
      return {
        ok: false,
        error: `${DOT_ENCODED_PATH_HINT} 当前值疑似错误编码: ${filePath.trim().slice(0, 120)}`,
      };
    }
  }

  const root = path.resolve(workDir);
  const abs = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(root, trimmed);

  const rootReal = await realpath(root).catch(() => root);
  let compareTarget = abs;
  try {
    compareTarget = await realpath(abs);
  } catch {
    const parent = path.dirname(abs);
    const parentReal = await realpath(parent).catch(() => path.resolve(parent));
    compareTarget = path.join(parentReal, path.basename(abs));
  }

  if (!isPathInsideWorkspace(rootReal, compareTarget)) {
    return {
      ok: false,
      error: `file_path 须位于当前工作区内。workDir=${workDir}，解析目标=${abs}`,
    };
  }

  return { ok: true, abs };
}
