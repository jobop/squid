/**
 * 验证定时任务触发后入队 + drain 通知（不调用真实 LLM，需自行接 TaskAPI 做集成测）
 */

import { cronManager } from './src/tools/cron-manager';
import { clearCommandQueue, getCommandQueueSnapshot } from './src/utils/messageQueueManager';

console.log('=== 定时任务入队测试 ===\n');

clearCommandQueue();

cronManager.setEnqueueDrainNotifier((conversationId) => {
  console.log(`\n✅ enqueueDrainNotifier: conversationId=${conversationId}`);
  console.log('   队列快照:', JSON.stringify(getCommandQueueSnapshot(), null, 2));
});

console.log('创建测试任务（每秒执行）...');
const result = cronManager.createTask('* * * * * *', '这是一个测试任务');

if (result.success) {
  console.log(`✅ 任务创建成功: ${result.taskId}\n`);
  console.log('等待任务触发（观察入队日志）...\n');

  setTimeout(() => {
    console.log('\n测试完成，清理任务...');
    cronManager.clear();
    clearCommandQueue();
    process.exit(0);
  }, 5000);
} else {
  console.error(`❌ 任务创建失败: ${result.error}`);
  process.exit(1);
}
