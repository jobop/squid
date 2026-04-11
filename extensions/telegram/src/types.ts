export interface TelegramChannelFileConfig {
  /** Token issued by BotFather */
  botToken?: string;
  /** Optional; used when outbound notifications do not include a chat target */
  defaultChatId?: string;
  /** If set, only process these chats (string IDs, including negative group IDs) */
  allowedChatIds?: string[];
  /** Default is https://api.telegram.org */
  apiBase?: string;
}
