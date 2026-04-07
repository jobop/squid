/** 对端 user id -> 最近一条入站的 context_token（回复时需带回） */
const peerToContext = new Map<string, string>();

export function rememberContextToken(peerUserId: string, token: string | undefined): void {
  const p = peerUserId.trim();
  if (!p || !token?.trim()) return;
  peerToContext.set(p, token.trim());
}

export function getContextTokenForPeer(peerUserId: string): string | undefined {
  return peerToContext.get(peerUserId.trim());
}
