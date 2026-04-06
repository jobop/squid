export interface TelegramChannelFileConfig {
  /** BotFather 下发的 token */
  botToken?: string;
  /** 可选；系统通知等出站未带 chat 时使用 */
  defaultChatId?: string;
  /** 若设置，仅处理这些 chat（字符串形式 id，含负数群 id） */
  allowedChatIds?: string[];
  /** 默认 https://api.telegram.org */
  apiBase?: string;
}
