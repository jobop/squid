import crypto from 'node:crypto';

/**
 * 与 OpenClaw `monitor.transport.ts` 一致：SHA256(timestamp + nonce + encryptKey + rawBody) hex
 */
export function isFeishuWebhookSignatureValid(params: {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  encryptKey?: string;
}): boolean {
  const encryptKey = params.encryptKey?.trim();
  if (!encryptKey) {
    return true;
  }

  const timestamp = headerFirst(params.headers['x-lark-request-timestamp']);
  const nonce = headerFirst(params.headers['x-lark-request-nonce']);
  const signature = headerFirst(params.headers['x-lark-signature']);
  if (!timestamp || !nonce || !signature) {
    return false;
  }

  const computed = crypto
    .createHash('sha256')
    .update(timestamp + nonce + encryptKey + params.rawBody)
    .digest('hex');

  return timingSafeEqualString(computed, signature);
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 与 OpenClaw 测试 `encryptFeishuPayload` 对称：AES-256-CBC，key = SHA256(encryptKey)，IV 为密文前 16 字节
 */
export function decryptFeishuEncryptField(encryptKey: string, encryptBase64: string): string {
  const buf = Buffer.from(encryptBase64, 'base64');
  if (buf.length <= 16) {
    throw new Error('encrypt payload too short');
  }
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}
