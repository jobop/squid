/**
 * 个人微信 iLink 扫码登录，写入 ~/.squid/weixin-personal-channel.json
 * 用法（在 squid 目录）：bun run weixin-personal:login
 */
import { startWeixinPersonalQrLogin, waitWeixinPersonalQrLogin } from '../extensions/weixin-personal/src/ilink-login';

async function main(): Promise<void> {
  const st = await startWeixinPersonalQrLogin();
  if (!st.qrcodeUrl) {
    console.error(st.message);
    process.exit(1);
  }
  const w = await waitWeixinPersonalQrLogin({ sessionKey: st.sessionKey });
  console.log(w.message);
  process.exit(w.connected ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
