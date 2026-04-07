// Electrobun backend entry point
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import { ClawServer } from '../claw/server';
import { CronScheduler } from '../scheduler/cron-scheduler';
import { TaskAPI, isTaskAPIConversationBusyError } from '../api/task-api';
import {
  channelRegistry,
  discoverChannelExtensions,
  getChannelExtensionLoadErrors,
  getChannelsOverview,
  getExtensionChannelPluginIds,
  handleFeishuWebhookRequest,
  initializeBuiltinChannels,
  loadChannelExtensionsConfigMerged,
  reloadChannelExtensions,
  saveUserChannelExtensionsEnabled,
} from '../channels/index';
import {
  buildPublicValuesForForm,
  findExtensionWebConfigForm,
  readUserConfigJson,
  saveExtensionWebConfig,
} from '../channels/extension-web-config';
import { runExtensionAuthPoll, runExtensionAuthStart } from '../channels/extension-web-auth';
import { cronManager } from '../tools/cron-manager';

/**
 * 开发态入口在 `src/bun`，打包后在 `Resources/app/bun` 且静态资源在 `Resources/app/public`。
 * 固定 `../../public` 在打包后会指到 `Resources/public`（通常不存在）导致白屏。
 */
function resolvePublicIndexHtmlPath(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 14; i++) {
    const candidate = join(dir, 'public', 'index.html');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(import.meta.dir, '..', '..', 'public', 'index.html');
}

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
          const status = result.queued ? 202 : 200;
          return new Response(JSON.stringify(result), { ...headers, status });
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
              const enc = new TextEncoder();
              try {
                await taskAPI.executeTaskStream(body, (chunk: string) => {
                  controller.enqueue(enc.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
                });
                controller.enqueue(enc.encode('data: [DONE]\n\n'));
                controller.close();
              } catch (error: unknown) {
                if (isTaskAPIConversationBusyError(error)) {
                  const pos = taskAPI.enqueueFromRequest(body, { source: 'user', priority: 'next' });
                  const payload = JSON.stringify({
                    queued: true,
                    conversationId: error.conversationId,
                    queuePosition: pos,
                    message:
                      '当前会话繁忙，已加入队列，将在上一任务结束后自动执行。',
                  });
                  controller.enqueue(enc.encode(`data: ${payload}\n\n`));
                  controller.enqueue(enc.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }
                const msg = error instanceof Error ? error.message : String(error);
                controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
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

      // 清空当前线程消息（聊天框 /reset）
      if (url.pathname === '/api/threads/clear-messages' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { threadId?: unknown };
          const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : undefined;
          const result = await taskAPI.clearThreadMessages(threadId || undefined);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      // 清空会话 + 全部记忆（聊天框 /new）
      if (url.pathname === '/api/sessions/new' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { threadId?: unknown };
          const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : undefined;
          const result = await taskAPI.newSessionClearAll(threadId || undefined);
          return new Response(JSON.stringify(result), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers,
          });
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
          const extIds = getExtensionChannelPluginIds();
          const channels = await getChannelsOverview(channelRegistry, extIds);
          const errors = getChannelExtensionLoadErrors();
          const merged = loadChannelExtensionsConfigMerged();
          const discovered = discoverChannelExtensions();
          const allow = new Set(merged.enabled ? merged.enabled : []);
          const extensionCatalog = discovered.map((d) => ({
            id: d.id,
            name: d.name,
            version: d.version,
            configEnabled: merged.enabledExplicit ? allow.has(d.id) : true,
            loaded: extIds.has(d.id),
          }));
          return new Response(
            JSON.stringify({
              channels,
              errors,
              extensionCatalog,
              extensionEnabledWhitelist: merged.enabledExplicit,
            }),
            { headers }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      if (url.pathname === '/api/channels/extensions/enabled' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { enabled?: unknown };
          if (!Array.isArray(body.enabled) || !body.enabled.every((x) => typeof x === 'string')) {
            return new Response(JSON.stringify({ success: false, error: 'enabled 须为字符串数组' }), {
              status: 400,
              headers,
            });
          }
          const save = saveUserChannelExtensionsEnabled(body.enabled as string[]);
          if (!save.ok) {
            return new Response(JSON.stringify({ success: false, error: save.error }), {
              status: 500,
              headers,
            });
          }
          await reloadChannelExtensions(channelRegistry);
          return new Response(JSON.stringify({ success: true }), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
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

      // 扩展在 channel-plugin.json 中声明 configForm 后的通用读写（飞书、Telegram 等）
      if (url.pathname === '/api/channels/extension-config' && req.method === 'GET') {
        try {
          const channelId = url.searchParams.get('channelId')?.trim() ?? '';
          if (!channelId) {
            return new Response(JSON.stringify({ error: '缺少 channelId' }), {
              status: 400,
              headers,
            });
          }
          const form = findExtensionWebConfigForm(channelId);
          if (!form) {
            return new Response(JSON.stringify({ error: '该渠道无扩展 Web 配置' }), {
              status: 404,
              headers,
            });
          }
          const raw = await readUserConfigJson(form.userConfigFile);
          const values = buildPublicValuesForForm(form, raw);
          return new Response(JSON.stringify({ form, values }), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      if (url.pathname === '/api/channels/extension-config' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { channelId?: unknown; values?: unknown };
          const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
          if (!channelId) {
            return new Response(JSON.stringify({ success: false, error: '缺少 channelId' }), {
              status: 400,
              headers,
            });
          }
          const form = findExtensionWebConfigForm(channelId);
          if (!form) {
            return new Response(JSON.stringify({ success: false, error: '该渠道无扩展 Web 配置' }), {
              status: 404,
              headers,
            });
          }
          const valuesRaw = body.values;
          if (valuesRaw === null || typeof valuesRaw !== 'object' || Array.isArray(valuesRaw)) {
            return new Response(JSON.stringify({ success: false, error: 'values 须为对象' }), {
              status: 400,
              headers,
            });
          }
          const stringMap: Record<string, string> = {};
          for (const [k, v] of Object.entries(valuesRaw as Record<string, unknown>)) {
            stringMap[k] = v != null ? String(v) : '';
          }
          const result = await saveExtensionWebConfig(channelId, form, stringMap);
          if (!result.ok) {
            return new Response(JSON.stringify({ success: false, errors: result.errors }), {
              status: 400,
              headers,
            });
          }
          try {
            await reloadChannelExtensions(channelRegistry);
          } catch (reloadErr: unknown) {
            console.error('[Channels] 扩展 Web 配置保存后重载失败:', reloadErr);
          }
          return new Response(JSON.stringify({ success: true }), { headers });
        } catch (error: any) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      if (url.pathname === '/api/channels/extension-auth/start' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { channelId?: unknown };
          const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
          const form = findExtensionWebConfigForm(channelId);
          const result = await runExtensionAuthStart({ channelId, form, registry: channelRegistry });
          if (!result.ok) {
            return new Response(JSON.stringify({ error: result.error }), {
              status: result.status,
              headers,
            });
          }
          return new Response(
            JSON.stringify({ authUrl: result.authUrl, sessionKey: result.sessionKey }),
            { headers }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      if (url.pathname === '/api/channels/extension-auth/poll' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { channelId?: unknown; sessionKey?: unknown };
          const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
          const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
          const form = findExtensionWebConfigForm(channelId);
          const result = await runExtensionAuthPoll({
            channelId,
            sessionKey,
            form,
            registry: channelRegistry,
          });
          if (!result.ok) {
            return new Response(JSON.stringify({ error: result.error }), {
              status: result.status,
              headers,
            });
          }
          /** 凭证已写入磁盘，必须重载扩展才会执行 initialize 并启动 getUpdates；否则仅靠保存表单才可能重载，且 Auth 进行中保存会被跳过 */
          if (result.status === 'success') {
            try {
              await reloadChannelExtensions(channelRegistry);
            } catch (reloadErr: unknown) {
              console.error('[Channels] 扩展 Auth 登录成功后重载失败:', reloadErr);
            }
          }
          return new Response(
            JSON.stringify({
              status: result.status,
              message: result.message,
              authUrl: result.authUrl,
            }),
            { headers }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers,
          });
        }
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  console.log(`API server started at http://localhost:${apiServer.port}`);

  const htmlPath = resolvePublicIndexHtmlPath();
  if (!existsSync(htmlPath)) {
    console.error(
      '[squid] 未找到 UI：',
      htmlPath,
      '（请确认 electrobun.config.ts 的 build.copy 已包含 public 目录）'
    );
  }
  const htmlUrl = pathToFileURL(htmlPath).href;
  console.log('Loading HTML from:', htmlPath);

  const mainWindow = new BrowserWindow({
    title: 'squid',
    url: htmlUrl,
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

  // Initialize Claw server
  const clawServer = new ClawServer({
    port: 3000,
    host: 'localhost',
    enabled: false
  } as any);

  // Initialize scheduler
  const scheduler = new CronScheduler();

  await initializeBuiltinChannels(taskAPI);
  console.log('Channel system initialized（扩展在 setup 内自行注册 squid-bridge）');

  taskAPI.setCronQueuedCompletionHandler((taskId, success, result) => {
    console.log(
      `[CronManager] 队列执行任务 ${taskId} 完成 success=${success} result=${result}`
    );
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(success ? '定时任务完成' : '定时任务失败', {
        body: result,
        icon: '/icon.png',
      });
    }
  });

  cronManager.setEnqueueDrainNotifier((conversationId) => {
    taskAPI.kickConversationQueueDrain(conversationId);
  });

  console.log('CronManager enqueue drain notifier + TaskAPI cron completion handler set');

  console.log('Backend initialized successfully');
}

main().catch(console.error);
