import { mkdir, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, resolve } from 'path';

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};

const IMAGE_EXT_ALLOWLIST = new Set(Object.values(IMAGE_EXT_BY_MIME));

function normalizeFilename(value: string | undefined): string {
  const name = String(value || '').trim();
  if (!name) return '';
  return basename(name).replace(/[^\w.\-]+/g, '_');
}

function inferImageExt(mimeType?: string, filenameHint?: string): string | null {
  const mt = String(mimeType || '').trim().toLowerCase();
  if (mt && IMAGE_EXT_BY_MIME[mt]) return IMAGE_EXT_BY_MIME[mt];
  const ext = extname(normalizeFilename(filenameHint)).replace('.', '').toLowerCase();
  if (ext && IMAGE_EXT_ALLOWLIST.has(ext)) return ext;
  return null;
}

function inferImageExtFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return 'tiff';
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    bytes[11] === 0x66
  ) {
    return 'avif';
  }
  return null;
}

function resolveInsideWorkspace(workspace: string, relPath: string): string {
  const absWorkspace = resolve(workspace);
  const absPath = resolve(absWorkspace, relPath);
  if (absPath !== absWorkspace && !absPath.startsWith(`${absWorkspace}/`)) {
    throw new Error('path escapes workspace');
  }
  return absPath;
}

export function isLikelyImageFile(filename?: string): boolean {
  const ext = extname(normalizeFilename(filename)).replace('.', '').toLowerCase();
  return !!ext && IMAGE_EXT_ALLOWLIST.has(ext);
}

export async function saveInboundImageToWorkspace(params: {
  workspace: string;
  bytes: Uint8Array;
  channelId: string;
  mimeType?: string;
  filenameHint?: string;
}): Promise<{ ok: true; relativePath: string; filename: string } | { ok: false; error: string }> {
  try {
    const workspace = String(params.workspace || '').trim();
    if (!workspace) return { ok: false, error: 'workspace is required' };
    const ext = inferImageExt(params.mimeType, params.filenameHint) || inferImageExtFromBytes(params.bytes);
    if (!ext) return { ok: false, error: 'unsupported image type' };
    const relPath = join(
      '.squid/attachments',
      `${String(params.channelId || 'channel').replace(/[^\w-]+/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    ).replace(/\\/g, '/');
    const absPath = resolveInsideWorkspace(workspace, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, params.bytes);
    return {
      ok: true,
      relativePath: relPath,
      filename: normalizeFilename(params.filenameHint) || relPath.split('/').pop() || `image.${ext}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
