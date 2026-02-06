/**
 * Arni Worker v4.0.0 - Autonomous Agent Platform
 *
 * Modular architecture:
 *   src/config.js       - Environment variable management
 *   src/utils.js        - Shared helpers (json, cors, formatTokens)
 *   src/services/       - Business logic (logger, tracking, claude-max, model-stats)
 *   src/handlers/       - Route handlers (status, webhooks, memory, tasks, notes, logs, config, proxy, usage)
 *   src/pages/          - HTML pages (dashboard, status)
 */

import { CORS_HEADERS } from './utils.js';
import { trackCloudflareUsage, getCloudflareUsage } from './services/tracking.js';
import { log, incrementStat } from './services/logger.js';
import { getModelStats } from './services/model-stats.js';
import { getClaudeMaxUsage } from './services/claude-max.js';

// Handlers
import { handleStatusPage, handleHealth, handlePing, handleStats } from './handlers/status.js';
import { handleWebhookReceive, handleWebhookList } from './handlers/webhooks.js';
import { handleMemoryList, handleMemoryGet, handleMemoryPut, handleMemoryDelete } from './handlers/memory.js';
import { handleTaskList, handleTaskCreate, handleTaskUpdate, handleTaskDelete } from './handlers/tasks.js';
import { handleNoteList, handleNoteCreate, handleNoteUpdate, handleNoteDelete } from './handlers/notes.js';
import { handleLogList } from './handlers/logs.js';
import { handleConfigGet, handleConfigPut } from './handlers/config.js';
import { handleProxy } from './handlers/proxy.js';
import { handleUsageLog, handleUsageList, handleUsageStats, handleUsageLive } from './handlers/usage.js';

// Pages
import { dashboardPage } from './pages/dashboard.js';
import { html } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      await trackCloudflareUsage(env, path);

      // --- Route matching ---
      const response = await route(request, env, url, path, method);
      if (response) return response;

      // 404
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });

    } catch (error) {
      await log(env, 'error', error.message);
      return new Response(JSON.stringify({ error: error.message, stack: error.stack }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },

  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    await log(env, 'cron', `Scheduled run at ${now}`);
    await incrementStat(env, 'cron_runs');
  },
};

async function route(request, env, url, path, method) {
  // ── Public endpoints ──
  if (path === '/' && method === 'GET')          return handleStatusPage();
  if (path === '/health' && method === 'GET')    return handleHealth(env);
  if (path === '/api/ping' && method === 'GET')  return handlePing();
  if (path === '/stats' && method === 'GET')     return handleStats(env);

  // ── Dashboard ──
  if (path === '/dashboard' && method === 'GET') {
    const [stats, cfUsage, maxUsage] = await Promise.all([
      getModelStats(env),
      getCloudflareUsage(env),
      getClaudeMaxUsage(env),
    ]);
    return html(dashboardPage(stats, cfUsage, maxUsage));
  }

  // ── Webhooks ──
  if (path === '/webhook' && method === 'POST')  return handleWebhookReceive(request, env);
  if (path === '/webhooks' && method === 'GET')  return handleWebhookList(env);

  // ── Memory / KV ──
  if (path === '/memory' && method === 'GET')    return handleMemoryList(url, env);
  if (path.startsWith('/memory/') && method === 'GET')    return handleMemoryGet(path, env);
  if (path.startsWith('/memory/') && method === 'PUT')    return handleMemoryPut(request, url, path, env);
  if (path.startsWith('/memory/') && method === 'DELETE') return handleMemoryDelete(path, env);

  // ── Tasks ──
  if (path === '/tasks' && method === 'GET')     return handleTaskList(env);
  if (path === '/tasks' && method === 'POST')    return handleTaskCreate(request, env);
  if (path.startsWith('/tasks/') && method === 'PUT')    return handleTaskUpdate(request, path, env);
  if (path.startsWith('/tasks/') && method === 'DELETE') return handleTaskDelete(path, env);

  // ── Notes ──
  if (path === '/notes' && method === 'GET')     return handleNoteList(env);
  if (path === '/notes' && method === 'POST')    return handleNoteCreate(request, env);
  if (path.startsWith('/notes/') && method === 'PUT')    return handleNoteUpdate(request, path, env);
  if (path.startsWith('/notes/') && method === 'DELETE') return handleNoteDelete(path, env);

  // ── Logs ──
  if (path === '/logs' && method === 'GET')      return handleLogList(url, env);

  // ── Config ──
  if (path === '/config' && method === 'GET')    return handleConfigGet(env);
  if (path === '/config' && method === 'PUT')    return handleConfigPut(request, env);

  // ── Proxy ──
  if (path === '/proxy' && method === 'POST')    return handleProxy(request, env);

  // ── Usage ──
  if (path === '/usage' && method === 'POST')    return handleUsageLog(request, env);
  if (path === '/usage' && method === 'GET')     return handleUsageList(url, env);
  if (path === '/usage/stats' && method === 'GET') return handleUsageStats(env);
  if (path === '/usage/live' && method === 'GET')  return handleUsageLive(env);

  return null;
}
