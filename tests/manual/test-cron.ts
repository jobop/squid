/**
 * 定时任务测试：入队 + drain 通知（完整执行需 bun 主进程中的 TaskAPI）
 */

import { cronManager } from '../../src/tools/cron-manager';
import { clearCommandQueue, getCommandQueueSnapshot } from '../../src/utils/messageQueueManager';

clearCommandQueue();

cronManager.setEnqueueDrainNotifier((conversationId) => {
  console.log(`\n[enqueueDrainNotifier] conversationId=${conversationId}`);
  console.log('队列快照:', JSON.stringify(getCommandQueueSnapshot(), null, 2));
});

console.log('创建测试定时任务...');
const result = cronManager.createTask('*/10 * * * * *', '列出当前目录的文件');

if (result.success) {
  console.log(`✅ 任务创建成功: ${result.taskId}`);
  console.log('等待任务触发（每 10 秒一次）...');
  console.log('按 Ctrl+C 退出\n');
} else {
  console.error(`❌ 任务创建失败: ${result.error}`);
  process.exit(1);
}

process.on('SIGINT', () => {
  console.log('\n清理任务...');
  cronManager.clear();
  clearCommandQueue();
  console.log('退出');
  process.exit(0);
});
