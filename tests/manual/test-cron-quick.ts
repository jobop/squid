/**
 * 定时任务快速测试：验证触发后入队 + drain 通知
 */

import { cronManager } from '../../src/tools/cron-manager';
import { clearCommandQueue, getCommandQueueSnapshot } from '../../src/utils/messageQueueManager';

let fireCount = 0;

clearCommandQueue();

cronManager.setEnqueueDrainNotifier((conversationId) => {
  fireCount++;
  console.log(`\n[enqueueDrainNotifier] #${fireCount} conversationId=${conversationId}`);
  console.log('队列快照:', JSON.stringify(getCommandQueueSnapshot(), null, 2));
});

console.log('创建测试定时任务（每秒执行）...');
const result = cronManager.createTask('* * * * * *', '列出当前目录的文件');

if (result.success) {
  console.log(`✅ 任务创建成功: ${result.taskId}`);
  console.log('等待任务触发...\n');

  setTimeout(() => {
    console.log(`\n测试完成，收到 ${fireCount} 次入队通知`);
    cronManager.clear();
    clearCommandQueue();
    process.exit(0);
  }, 3500);
} else {
  console.error(`❌ 任务创建失败: ${result.error}`);
  process.exit(1);
}
