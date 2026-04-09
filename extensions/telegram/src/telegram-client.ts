const DEFAULT_API = 'https://api.telegram.org';
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export function splitTelegramText(text: string, max = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}

function apiRoot(apiBase: string | undefined): string {
  return (apiBase?.trim() || DEFAULT_API).replace(/\/$/, '');
}

export async function telegramSendMessage(
  botToken: string,
  chatId: string,
  text: string,
  options?: { apiBase?: string; signal?: AbortSignal }
): Promise<{ success: boolean; error?: string }> {
  const base = apiRoot(options?.apiBase);
  const token = botToken.trim();
  const chunks = splitTelegramText(text.trim() || '(空回复)');
  for (const part of chunks) {
    const res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part }),
      signal: options?.signal,
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      return { success: false, error: data.description ?? `HTTP ${res.status}` };
    }
  }
  return { success: true };
}

export interface TelegramMessageUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number; width?: number; height?: number }>;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    chat?: { id: number; type?: string };
    from?: { id: number; is_bot?: boolean };
  };
}

export async function telegramGetFilePath(
  botToken: string,
  fileId: string,
  options?: { apiBase?: string; signal?: AbortSignal }
): Promise<{ ok: true; filePath: string } | { ok: false; error: string }> {
  const base = apiRoot(options?.apiBase);
  const token = botToken.trim();
  const url = new URL(`${base}/bot${token}/getFile`);
  url.searchParams.set('file_id', fileId);
  const res = await fetch(url.href, { signal: options?.signal });
  const data = (await res.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
    description?: string;
  };
  const filePath = data.result?.file_path;
  if (!data.ok || typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: data.description ?? `getFile failed: HTTP ${res.status}` };
  }
  return { ok: true, filePath: filePath.trim() };
}

export async function telegramDownloadFileByPath(
  botToken: string,
  filePath: string,
  options?: { apiBase?: string; signal?: AbortSignal }
): Promise<{ ok: true; bytes: Uint8Array; contentType?: string } | { ok: false; error: string }> {
  const base = apiRoot(options?.apiBase);
  const token = botToken.trim();
  const cleanPath = String(filePath || '').replace(/^\/+/, '');
  const res = await fetch(`${base}/file/bot${token}/${cleanPath}`, { signal: options?.signal });
  if (!res.ok) {
    return { ok: false, error: `download failed: HTTP ${res.status}` };
  }
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  return {
    ok: true,
    bytes,
    contentType: res.headers.get('content-type') || undefined,
  };
}

export async function telegramDownloadFileById(
  botToken: string,
  fileId: string,
  options?: { apiBase?: string; signal?: AbortSignal }
): Promise<{ ok: true; bytes: Uint8Array; filePath: string; contentType?: string } | { ok: false; error: string }> {
  const p = await telegramGetFilePath(botToken, fileId, options);
  if (!p.ok) return p;
  const d = await telegramDownloadFileByPath(botToken, p.filePath, options);
  if (!d.ok) return d;
  return { ok: true, bytes: d.bytes, filePath: p.filePath, contentType: d.contentType };
}

export async function telegramGetUpdates(
  botToken: string,
  offset: number,
  options?: { apiBase?: string; signal?: AbortSignal; timeout?: number }
): Promise<{ ok: true; result: TelegramMessageUpdate[] } | { ok: false; error: string }> {
  const base = apiRoot(options?.apiBase);
  const token = botToken.trim();
  const timeout = options?.timeout ?? 25;
  const url = new URL(`${base}/bot${token}/getUpdates`);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('timeout', String(timeout));
  const res = await fetch(url.href, { signal: options?.signal });
  const data = (await res.json()) as {
    ok?: boolean;
    result?: TelegramMessageUpdate[];
    description?: string;
  };
  if (!data.ok || !Array.isArray(data.result)) {
    return { ok: false, error: data.description ?? `HTTP ${res.status}` };
  }
  return { ok: true, result: data.result };
}
