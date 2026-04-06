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
    chat?: { id: number; type?: string };
    from?: { id: number; is_bot?: boolean };
  };
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
