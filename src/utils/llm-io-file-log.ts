import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

function resolveLlmIoLogFilePath(): string {
  const raw = (process.env.SQUID_LLM_IO_LOG_FILE || '').trim();
  if (raw) return raw;
  return join(homedir(), '.squid', 'logs', 'llm-io.log');
}

let ensureDirPromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureLogDir(): Promise<void> {
  if (!ensureDirPromise) {
    const filePath = resolveLlmIoLogFilePath();
    ensureDirPromise = mkdir(dirname(filePath), { recursive: true }).then(() => undefined);
  }
  await ensureDirPromise;
}

export function appendLlmIoFileLog(message: string, payload?: string): Promise<void> {
  const filePath = resolveLlmIoLogFilePath();
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    type: 'llm-io',
    message,
  };
  if (payload != null && payload.length > 0) {
    entry.payload = payload;
  }
  const line = `${JSON.stringify(entry)}\n`;

  writeQueue = writeQueue
    .then(async () => {
      await ensureLogDir();
      await appendFile(filePath, line, 'utf8');
    })
    .catch(() => {
      // LLM I/O debug logging must not affect task execution.
    });

  return writeQueue;
}
