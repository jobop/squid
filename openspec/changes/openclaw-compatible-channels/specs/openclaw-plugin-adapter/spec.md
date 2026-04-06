## ADDED Requirements

### Requirement: 系统应提供 OpenClaw 插件适配器
系统 SHALL 提供适配器，让 OpenClaw 飞书插件能在 squid 上运行。

#### Scenario: 加载 OpenClaw 插件
- **WHEN** 加载 OpenClaw 飞书插件
- **THEN** 适配器包装该插件
- **AND** 插件可以正常初始化

#### Scenario: 适配消息发送接口
- **WHEN** 引擎需要通过飞书发送消息
- **THEN** 适配器调用 OpenClaw 插件的发送方法
- **AND** 消息成功发送到飞书

#### Scenario: 适配消息接收接口
- **WHEN** 飞书收到用户消息
- **THEN** OpenClaw 插件触发消息事件
- **AND** 适配器将消息转发到 EventBridge

#### Scenario: 适配配置接口
- **WHEN** 插件需要读取配置
- **THEN** 适配器提供配置数据
- **AND** 插件可以正常工作

### Requirement: 适配器应只实现必需接口
系统 SHALL 按需实现 OpenClaw 接口，不需要完整实现。

#### Scenario: 识别必需接口
- **WHEN** 研究飞书插件代码
- **THEN** 列出插件实际使用的接口
- **AND** 只实现这些接口

#### Scenario: 缺失接口处理
- **WHEN** 插件调用未实现的接口
- **THEN** 适配器返回合理的默认值或抛出明确错误
- **AND** 记录警告日志

### Requirement: 适配器应集成 EventBridge
系统 SHALL 将 OpenClaw 插件集成到 EventBridge。

#### Scenario: 订阅任务完成事件
- **WHEN** 任务完成
- **THEN** 适配器收到事件
- **AND** 通过飞书插件发送通知

#### Scenario: 转发飞书消息到引擎
- **WHEN** 飞书收到用户消息
- **THEN** 适配器解析消息
- **AND** 通过 EventBridge 发送命令到引擎
