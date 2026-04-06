/** Telegram 扩展实现于 extensions/telegram/；此处为 Bun 与测试的稳定入口 */
export type { TelegramChannelFileConfig } from '../../../extensions/telegram/src/types';
export {
  getTelegramChannelConfigPath,
  loadTelegramChannelConfigSync,
  toTelegramConfigPublicView,
  validateTelegramChannelConfig,
} from '../../../extensions/telegram/src/config-store';
export { registerTelegramSquidBridge } from '../../../extensions/telegram/src/squid-bridge';
export { TelegramChannelPlugin } from '../../../extensions/telegram/src/plugin';
export { telegramSendMessage, TELEGRAM_MAX_MESSAGE_CHARS } from '../../../extensions/telegram/src/telegram-client';
