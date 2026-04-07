// Channel Plugin System Types
// 参考 OpenClaw 设计，完全自主实现

/**
 * 通知消息
 */
export interface NotificationMessage {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * 通知发送结果
 */
export interface NotificationResult {
  success: boolean;
  error?: string;
}

/**
 * 渠道元信息
 */
export interface ChannelMeta {
  name: string;
  description: string;
  icon?: string;
  category: 'builtin' | 'third-party';
}

/**
 * 渠道能力声明
 */
export interface ChannelCapabilities {
  outbound: {
    text: boolean;      // 支持文本消息
    media: boolean;     // 支持媒体消息
    rich: boolean;      // 支持富文本
    streaming: boolean; // 支持流式输出
  };
  inbound: {
    text: boolean;      // 支持接收文本
    commands: boolean;  // 支持命令
    interactive: boolean; // 支持交互式对话
  };
}

/**
 * 配置适配器（必须实现）
 */
export interface ChannelConfigAdapter {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  getAll(): Record<string, any>;
  validate(): boolean;  // 验证配置是否完整
}

/**
 * 出站适配器（必须实现）
 */
export interface ChannelOutboundAdapter {
  sendText(params: { content: string; title?: string }): Promise<NotificationResult>;
  sendNotification(message: NotificationMessage): Promise<NotificationResult>;
}

/**
 * 入站适配器（可选，支持双向通信）
 */
export interface ChannelInboundAdapter {
  onMessage(callback: (message: any) => void): void;
}

/**
 * 状态适配器（必须实现）
 */
export interface ChannelStatusAdapter {
  check(): Promise<{ healthy: boolean; message?: string }>;
}

/**
 * 初始化适配器（可选）
 */
export interface ChannelSetupAdapter {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * 生命周期适配器（可选）
 */
export interface ChannelLifecycleAdapter {
  onStart(): Promise<void>;
  onStop(): Promise<void>;
}

/**
 * 认证适配器（可选）
 */
export interface ChannelAuthAdapter {
  authenticate(): Promise<boolean>;
  isAuthenticated(): boolean;
}

/**
 * 渠道配置页 Auth 链接 Web 认证（由宿主调插件，非 OpenClaw）
 */
export interface ChannelExtensionWebAuth {
  startAuthLink(): Promise<{ authUrl: string; sessionKey: string }>;
  pollAuthLogin(
    sessionKey: string
  ): Promise<{ status: 'pending' | 'success' | 'failed'; message?: string; authUrl?: string }>;
}

/**
 * Channel 插件接口
 *
 * v1 必须实现：config, outbound, status
 * v1 建议实现：inbound（支持双向通信）
 * v2 再实现：setup, lifecycle, auth
 */
export interface ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  // v1 必须实现的适配器
  config: ChannelConfigAdapter;
  outbound: ChannelOutboundAdapter;
  status: ChannelStatusAdapter;

  // v1 可选但建议实现
  inbound?: ChannelInboundAdapter;

  // v2 再实现
  setup?: ChannelSetupAdapter;
  lifecycle?: ChannelLifecycleAdapter;
  auth?: ChannelAuthAdapter;

  /** 可选：配合 configForm.authUi=auth_link 与 /api/channels/extension-auth/* */
  extensionWebAuth?: ChannelExtensionWebAuth;
}
