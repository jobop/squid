// Electrobun backend entry point
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import { ClawServer } from '../claw/server';
import { CronScheduler } from '../scheduler/cron-scheduler';
import { MCPConnectionManager } from '../mcp/connection-manager';
import { TaskAPI } from '../api/task-api';
import {
  channelRegistry,
  getChannelsOverview,
  handleFeishuWebhookRequest,
  initializeBuiltinChannels,
  registerFeishuSquidBridge,
} from '../channels/index';
import {
  loadFeishuChannelConfig,
  saveFeishuChannelConfig,
  toFeishuConfigPublicView,
} from '../channels/feishu/config-store';
import { cronManager } from '../tools/cron-manager';

async function main() {
  console.log('squid - Backend starting...');

  // Initialize Task API
  const taskAPI = new TaskAPI();

  // Start HTTP API server for frontend communication
  const apiServer = Bun.serve({
    port: 50001,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers });
      }

      // Execute task
      if (url.pathname === '/api/task/execute' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.executeTask(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Execute task with streaming
      if (url.pathname === '/api/task/execute-stream' && req.method === 'POST') {
        try {
          const body = await req.json();

          const stream = new ReadableStream({
            async start(controller) {
              try {
                await taskAPI.executeTaskStream(body, (chunk: string) => {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
                });
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                controller.close();
              } catch (error: any) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
                controller.close();
              }
            }
          });

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // List tasks
      if (url.pathname === '/api/tasks' && req.method === 'GET') {
        try {
          const tasks = await taskAPI.listTasks();
          return new Response(JSON.stringify(tasks), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify([]), { headers });
        }
      }

      // List skills
      if (url.pathname === '/api/skills' && req.method === 'GET') {
        try {
          const skills = await taskAPI.listSkills();
          return new Response(JSON.stringify(skills), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify([]), { headers });
        }
      }

      // Generate skill from natural language
      if (url.pathname === '/api/skills/generate' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.generateSkill(body.description);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Save skill
      if (url.pathname === '/api/skills/save' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.saveSkill(body.yaml);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Preview skill before installation
      if (url.pathname === '/api/skills/preview' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.previewSkill(body.url);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Install skill
      if (url.pathname === '/api/skills/install' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.installSkill(body.data);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // List Tencent SkillHub skills
      if (url.pathname === '/api/skillhub/tencent/skills' && req.method === 'GET') {
        try {
          const query = url.searchParams.get('query') || undefined;
          const limit = Number(url.searchParams.get('limit') || '20');
          const result = await taskAPI.listTencentSkillHubSkills(query, limit);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            skills: [],
            total: 0,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Install Tencent SkillHub skill
      if (url.pathname === '/api/skillhub/tencent/install' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.installTencentSkillHubSkill({
            slug: body.slug,
            version: body.version,
            force: body.force
          });
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // List installed Tencent SkillHub skills
      if (url.pathname === '/api/skillhub/tencent/installed' && req.method === 'GET') {
        try {
          const result = await taskAPI.listTencentInstalledSkills();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            skills: [],
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get installed Tencent SkillHub skill detail
      if (url.pathname.startsWith('/api/skillhub/tencent/installed/') && req.method === 'GET') {
        try {
          const slug = decodeURIComponent(url.pathname.split('/').pop() || '');
          const result = await taskAPI.getTencentInstalledSkillDetail(slug);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Uninstall installed Tencent SkillHub skill
      if (url.pathname.startsWith('/api/skillhub/tencent/installed/') && req.method === 'DELETE') {
        try {
          const slug = decodeURIComponent(url.pathname.split('/').pop() || '');
          const result = await taskAPI.uninstallTencentInstalledSkill(slug);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Uninstall installed Tencent SkillHub skill (POST fallback for CORS simplicity)
      if (url.pathname === '/api/skillhub/tencent/uninstall' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.uninstallTencentInstalledSkill(body.slug);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // List experts
      if (url.pathname === '/api/experts' && req.method === 'GET') {
        try {
          const experts = await taskAPI.listExperts();
          return new Response(JSON.stringify(experts), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify([]), { headers });
        }
      }

      // Get expert by ID
      if (url.pathname.startsWith('/api/experts/') && req.method === 'GET') {
        try {
          const id = url.pathname.split('/').pop();
          const expert = await taskAPI.getExpert(id!);
          return new Response(JSON.stringify(expert || null), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify(null), { headers });
        }
      }

      // Switch expert for a task
      if (url.pathname === '/api/tasks/switch-expert' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.switchExpert(body.taskId, body.expertId);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Generate expert from description
      if (url.pathname === '/api/experts/generate' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.generateExpertFromDescription(body.description);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Create custom expert
      if (url.pathname === '/api/experts/create' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.createCustomExpert(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get model config
      if (url.pathname === '/api/config/model' && req.method === 'GET') {
        try {
          const config = await taskAPI.getModelConfig();
          return new Response(JSON.stringify(config), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({}), { headers });
        }
      }

      // Save model config
      if (url.pathname === '/api/config/model' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.saveModelConfig(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Test model config
      if (url.pathname === '/api/config/model/test' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.testModelConfig(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get workspace config
      if (url.pathname === '/api/config/workspace' && req.method === 'GET') {
        try {
          const config = await taskAPI.getWorkspaceConfig();
          return new Response(JSON.stringify(config), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({}), { headers });
        }
      }

      // Save workspace config
      if (url.pathname === '/api/config/workspace' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.saveWorkspaceConfig(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Pick local directory using native system dialog
      if (url.pathname === '/api/system/pick-directory' && req.method === 'POST') {
        try {
          const result = await taskAPI.pickDirectory();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Clear conversation
      if (url.pathname === '/api/conversation/clear' && req.method === 'POST') {
        try {
          const result = await taskAPI.clearConversation();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Start a new thread (detach current conversation without deleting history)
      if (url.pathname === '/api/threads/new' && req.method === 'POST') {
        try {
          const result = await taskAPI.startNewThread();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // List thread summaries
      if (url.pathname === '/api/threads' && req.method === 'GET') {
        try {
          const result = await taskAPI.listThreads();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            threads: [],
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Switch active thread
      if (url.pathname === '/api/threads/switch' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.switchThread(body.threadId);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Delete a thread
      if (url.pathname === '/api/threads/delete' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.deleteThread(body.threadId);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get conversation history
      if (url.pathname === '/api/conversation/history' && req.method === 'GET') {
        try {
          const history = await taskAPI.getConversationHistory();
          return new Response(JSON.stringify(history), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify([]), { headers });
        }
      }

      // Compress conversation
      if (url.pathname === '/api/conversation/compress' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.compressConversation(body.conversationId, body.manual || false);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get conversation usage
      if (url.pathname === '/api/conversation/usage' && req.method === 'GET') {
        try {
          const conversationId = url.searchParams.get('id') || undefined;
          const result = await taskAPI.getConversationUsage(conversationId);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Memory API routes
      // List memories
      if (url.pathname === '/api/memory' && req.method === 'GET') {
        try {
          const type = url.searchParams.get('type') || undefined;
          const result = await taskAPI.listMemories(type);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get memory by ID
      if (url.pathname.match(/^\/api\/memory\/[^\/]+$/) && req.method === 'GET') {
        try {
          const id = url.pathname.split('/').pop()!;
          const result = await taskAPI.getMemory(id);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Create memory
      if (url.pathname === '/api/memory' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.createMemory(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Update memory
      if (url.pathname.match(/^\/api\/memory\/[^\/]+$/) && req.method === 'PUT') {
        try {
          const id = url.pathname.split('/').pop()!;
          const body = await req.json();
          const result = await taskAPI.updateMemory(id, body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Delete memory
      if (url.pathname.match(/^\/api\/memory\/[^\/]+$/) && req.method === 'DELETE') {
        try {
          const id = url.pathname.split('/').pop()!;
          const result = await taskAPI.deleteMemory(id);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Search memories
      if (url.pathname === '/api/memory/search' && req.method === 'GET') {
        try {
          const query = url.searchParams.get('q') || '';
          const result = await taskAPI.searchMemories(query);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Trigger manual extraction
      if (url.pathname === '/api/memory/extract' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.triggerManualExtraction(body.conversationId);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            created: 0,
            skipped: 0,
            errors: [error.message]
          }), { status: 500, headers });
        }
      }

      // Get extraction config
      if (url.pathname === '/api/config/extraction' && req.method === 'GET') {
        try {
          const result = await taskAPI.getExtractionConfig();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Save extraction config
      if (url.pathname === '/api/config/extraction' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await taskAPI.saveExtractionConfig(body);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Get extraction stats
      if (url.pathname === '/api/memory/stats' && req.method === 'GET') {
        try {
          const result = await taskAPI.getExtractionStats();
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message
          }), { status: 500, headers });
        }
      }

      // Channel 管理 UI：列表与健康状态（侧栏「渠道」页调用）
      if (url.pathname === '/api/channels' && req.method === 'GET') {
        try {
          const list = await getChannelsOverview(channelRegistry);
          return new Response(JSON.stringify(list), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      // Feishu event subscription webhook (POST, raw body for signature)
      if (url.pathname === '/api/feishu/webhook' && req.method === 'POST') {
        try {
          return await handleFeishuWebhookRequest(req);
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      // 飞书凭证：Channel 详情表单用 GET 加载（脱敏）、POST 保存；与 GET /api/channels 列表配合使用
      if (url.pathname === '/api/channels/feishu/config' && req.method === 'GET') {
        try {
          const c = await loadFeishuChannelConfig();
          return new Response(JSON.stringify(toFeishuConfigPublicView(c)), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      if (url.pathname === '/api/channels/feishu/config' && req.method === 'POST') {
        try {
          const body = await req.json();
          const result = await saveFeishuChannelConfig(body);
          if (!result.ok) {
            return new Response(JSON.stringify({ success: false, errors: result.errors }), {
              status: 400,
              headers,
            });
          }
          const c = await loadFeishuChannelConfig();
          return new Response(
            JSON.stringify({ success: true, config: toFeishuConfigPublicView(c) }),
            { headers }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  console.log(`API server started at http://localhost:${apiServer.port}`);

  // Use absolute path
  const htmlPath = '/Users/myidd007/My project/yaoc/jobopx-desktop/public/index.html';
  console.log('Loading HTML from:', htmlPath);

  // Create main window with file URL
  const mainWindow = new BrowserWindow({
    title: 'squid',
    url: `file://${htmlPath}`,
    width: 1200,
    height: 800
  } as any);

  // 设置标准应用菜单，启用系统级编辑快捷键（复制/粘贴/撤销等）。
  ApplicationMenu.setApplicationMenu([
    {
      label: 'squid',
      submenu: [
        { role: 'about' },
        { type: 'divider' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'showAll' },
        { type: 'divider' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'divider' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'divider' },
        { role: 'close' }
      ]
    }
  ] as any);

  // Initialize MCP connection manager
  const mcpManager = new MCPConnectionManager();
  await mcpManager.loadConfigs();

  // Initialize Claw server
  const clawServer = new ClawServer({
    port: 3000,
    host: 'localhost',
    enabled: false
  } as any);

  // Initialize scheduler
  const scheduler = new CronScheduler();

  // Initialize channel system
  await initializeBuiltinChannels();
  registerFeishuSquidBridge(taskAPI);
  console.log('Channel system initialized (Feishu ↔ squid 入站桥接已注册)');

  // 设置 cronManager 的通知回调，连接到 EventBridge
  cronManager.setNotificationCallback((taskId: string, content: string) => {
    console.log(`[CronManager] 任务 ${taskId} 执行完成`);
    // 避免重复推送：执行器内部已经通过 TaskExecutor 上报 task:complete 事件。
    // 这里保留日志即可，UI 侧只展示一次完成消息。
  });

  // 设置 cronManager 的任务执行器
  cronManager.setTaskExecutor(async (prompt: string, taskId: string) => {
    console.log(`[CronManager] 执行定时任务 ${taskId}: ${prompt}`);

    try {
      const workspaceConfig = await taskAPI.getWorkspaceConfig();
      const workspace = workspaceConfig.workspace || process.cwd();

      // 调用 TaskAPI 执行任务
      const result = await taskAPI.executeTask({
        mode: 'ask',
        workspace,
        instruction: prompt,
        conversationId: undefined, // 定时任务使用独立的对话
      });

      return {
        success: result.success && !result.error,
        result: result.output || result.error || '任务执行完成',
      };
    } catch (error) {
      console.error(`[CronManager] 任务执行失败:`, error);
      return {
        success: false,
        result: (error as Error).message,
      };
    }
  });

  console.log('CronManager notification callback and task executor set');

  console.log('Backend initialized successfully');
}

main().catch(console.error);
