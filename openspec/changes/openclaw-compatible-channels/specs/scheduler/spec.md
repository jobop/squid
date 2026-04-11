## ADDED Requirements

### Requirement: Cron 管理器应在任务完成时发送事件
系统 SHALL 在定时任务完成时通过 EventBridge 发送事件。

#### Scenario: 任务成功完成
- **WHEN** 定时任务执行成功
- **THEN** 调用 eventBridge.notifyTaskComplete
- **AND** 包含任务 ID 和执行结果

#### Scenario: 任务执行失败
- **WHEN** 定时任务执行失败
- **THEN** 调用 eventBridge.notifyTaskComplete
- **AND** 包含任务 ID 和错误信息

#### Scenario: 事件包含完整信息
- **WHEN** 发送任务完成事件
- **THEN** 事件包含任务 ID、名称、结果、耗时等信息
- **AND** channel 可以根据这些信息显示通知
