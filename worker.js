/**
 * Arni Worker v2.7.0 - Full Autonomous Agent Platform
 *
 * Features:
 * - Webhook receiver
 * - Persistent KV memory
 * - Task/Note management
 * - Activity logs
 * - Config storage
 * - HTTP proxy for external requests
 * - Cron job support
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Simple API key auth for sensitive endpoints
    const apiKey = request.headers.get('X-Api-Key');
    const validKey = env.API_KEY || 'arni-2026';

    try {
      // Track this request for Cloudflare usage stats
      await trackCloudflareUsage(env, path);

      // ==================== PUBLIC ENDPOINTS ====================

      // Status page
      if (path === '/' && method === 'GET') {
        return new Response(statusPage(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        });
      }

      // Dashboard - Model Usage Analytics
      if (path === '/dashboard' && method === 'GET') {
        const stats = await getModelStats(env);
        const cfUsage = await getCloudflareUsage(env);
        const maxUsage = await getClaudeMaxUsage(env);
        return new Response(dashboardPage(stats, cfUsage, maxUsage), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        });
      }

      // Health check
      if (path === '/health' && method === 'GET') {
        const stats = await getStats(env);
        return json({
          status: 'ok',
          agent: 'arni',
          timestamp: new Date().toISOString(),
          version: '2.7.0',
          kv: env.MEMORY ? 'connected' : 'not bound',
          stats,
        }, corsHeaders);
      }

      // Ping
      if (path === '/api/ping' && method === 'GET') {
        return json({ pong: true, time: Date.now() }, corsHeaders);
      }

      // ==================== WEBHOOK ====================

      if (path === '/webhook' && method === 'POST') {
        const body = await request.text();
        let data;
        try {
          data = JSON.parse(body);
        } catch (e) {
          data = { raw: body };
        }

        const source = request.headers.get('X-Webhook-Source') || 'unknown';
        const webhookId = `webhook:${Date.now()}:${source}`;

        if (env.MEMORY) {
          await env.MEMORY.put(webhookId, JSON.stringify({
            timestamp: new Date().toISOString(),
            source,
            headers: Object.fromEntries(request.headers),
            data,
          }), { expirationTtl: 86400 * 30 }); // 30 days

          await incrementStat(env, 'webhooks_received');
        }

        await log(env, 'webhook', `Received from ${source}`);

        return json({
          received: true,
          id: webhookId,
          timestamp: new Date().toISOString(),
        }, corsHeaders);
      }

      // List webhooks
      if (path === '/webhooks' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'webhook:', limit: 50 });
        return json({
          webhooks: list.keys.map(k => ({
            id: k.name,
            expiration: k.expiration
          }))
        }, corsHeaders);
      }

      // ==================== MEMORY/KV ====================

      if (path === '/memory' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const prefix = url.searchParams.get('prefix') || '';
        const list = await env.MEMORY.list({ prefix, limit: 100 });
        return json({ keys: list.keys.map(k => k.name) }, corsHeaders);
      }

      if (path.startsWith('/memory/') && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const key = decodeURIComponent(path.replace('/memory/', ''));
        const value = await env.MEMORY.get(key);
        if (value === null) return json({ error: 'Key not found' }, corsHeaders, 404);
        try {
          return json({ key, value: JSON.parse(value) }, corsHeaders);
        } catch {
          return json({ key, value }, corsHeaders);
        }
      }

      if (path.startsWith('/memory/') && method === 'PUT') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const key = decodeURIComponent(path.replace('/memory/', ''));
        const body = await request.text();
        const ttl = url.searchParams.get('ttl');
        const options = ttl ? { expirationTtl: parseInt(ttl) } : {};
        await env.MEMORY.put(key, body, options);
        return json({ stored: true, key }, corsHeaders);
      }

      if (path.startsWith('/memory/') && method === 'DELETE') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const key = decodeURIComponent(path.replace('/memory/', ''));
        await env.MEMORY.delete(key);
        return json({ deleted: true, key }, corsHeaders);
      }

      // ==================== TASKS ====================

      if (path === '/tasks' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'task:', limit: 100 });
        const tasks = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? { id: k.name, ...JSON.parse(val) } : null;
          })
        );
        return json({ tasks: tasks.filter(Boolean) }, corsHeaders);
      }

      if (path === '/tasks' && method === 'POST') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const body = await request.json();
        const id = `task:${Date.now()}`;
        const task = {
          title: body.title,
          description: body.description || '',
          status: 'pending',
          priority: body.priority || 'normal',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        await env.MEMORY.put(id, JSON.stringify(task));
        await log(env, 'task', `Created: ${body.title}`);
        return json({ created: true, id, task }, corsHeaders);
      }

      if (path.startsWith('/tasks/') && method === 'PUT') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const id = 'task:' + path.replace('/tasks/', '');
        const existing = await env.MEMORY.get(id);
        if (!existing) return json({ error: 'Task not found' }, corsHeaders, 404);
        const task = JSON.parse(existing);
        const updates = await request.json();
        const updated = { ...task, ...updates, updated: new Date().toISOString() };
        await env.MEMORY.put(id, JSON.stringify(updated));
        await log(env, 'task', `Updated: ${updated.title} -> ${updates.status || 'modified'}`);
        return json({ updated: true, id, task: updated }, corsHeaders);
      }

      if (path.startsWith('/tasks/') && method === 'DELETE') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const id = 'task:' + path.replace('/tasks/', '');
        await env.MEMORY.delete(id);
        await log(env, 'task', `Deleted: ${id}`);
        return json({ deleted: true, id }, corsHeaders);
      }

      // ==================== NOTES ====================

      if (path === '/notes' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'note:', limit: 100 });
        const notes = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? { id: k.name, ...JSON.parse(val) } : null;
          })
        );
        return json({ notes: notes.filter(Boolean) }, corsHeaders);
      }

      if (path === '/notes' && method === 'POST') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const body = await request.json();
        const id = `note:${Date.now()}`;
        const note = {
          title: body.title || 'Untitled',
          content: body.content,
          tags: body.tags || [],
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        await env.MEMORY.put(id, JSON.stringify(note));
        await log(env, 'note', `Created: ${note.title}`);
        return json({ created: true, id, note }, corsHeaders);
      }

      if (path.startsWith('/notes/') && method === 'PUT') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const id = 'note:' + path.replace('/notes/', '');
        const existing = await env.MEMORY.get(id);
        if (!existing) return json({ error: 'Note not found' }, corsHeaders, 404);
        const note = JSON.parse(existing);
        const updates = await request.json();
        const updated = { ...note, ...updates, updated: new Date().toISOString() };
        await env.MEMORY.put(id, JSON.stringify(updated));
        return json({ updated: true, id, note: updated }, corsHeaders);
      }

      if (path.startsWith('/notes/') && method === 'DELETE') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const id = 'note:' + path.replace('/notes/', '');
        await env.MEMORY.delete(id);
        return json({ deleted: true, id }, corsHeaders);
      }

      // ==================== LOGS ====================

      if (path === '/logs' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const category = url.searchParams.get('category');
        const prefix = category ? `log:${category}:` : 'log:';
        const list = await env.MEMORY.list({ prefix, limit });
        const logs = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? JSON.parse(val) : null;
          })
        );
        return json({ logs: logs.filter(Boolean).reverse() }, corsHeaders);
      }

      // ==================== CONFIG ====================

      if (path === '/config' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const config = await env.MEMORY.get('config:main');
        return json({ config: config ? JSON.parse(config) : {} }, corsHeaders);
      }

      if (path === '/config' && method === 'PUT') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const body = await request.text();
        await env.MEMORY.put('config:main', body);
        await log(env, 'config', 'Configuration updated');
        return json({ updated: true }, corsHeaders);
      }

      // ==================== PROXY ====================

      if (path === '/proxy' && method === 'POST') {
        const body = await request.json();
        const { url: targetUrl, method: targetMethod = 'GET', headers: targetHeaders = {}, data } = body;

        if (!targetUrl) return json({ error: 'URL required' }, corsHeaders, 400);

        const proxyResponse = await fetch(targetUrl, {
          method: targetMethod,
          headers: targetHeaders,
          body: data ? JSON.stringify(data) : undefined,
        });

        const responseText = await proxyResponse.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = responseText;
        }

        await log(env, 'proxy', `${targetMethod} ${targetUrl} -> ${proxyResponse.status}`);

        return json({
          status: proxyResponse.status,
          headers: Object.fromEntries(proxyResponse.headers),
          data: responseData,
        }, corsHeaders);
      }

      // ==================== STATS ====================

      if (path === '/stats' && method === 'GET') {
        const stats = await getStats(env);
        return json({ stats }, corsHeaders);
      }

      // ==================== MODEL USAGE ====================

      // Log model usage
      if (path === '/usage' && method === 'POST') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const body = await request.json();
        const { provider, model, tokens_in, tokens_out, cost, task_type, success } = body;

        const id = `usage:${Date.now()}`;
        const usage = {
          timestamp: new Date().toISOString(),
          provider: provider || 'unknown',
          model: model || 'unknown',
          tokens_in: tokens_in || 0,
          tokens_out: tokens_out || 0,
          cost: cost || 0,
          task_type: task_type || 'general',
          success: success !== false,
        };

        await env.MEMORY.put(id, JSON.stringify(usage), { expirationTtl: 86400 * 90 }); // 90 days

        // Update aggregated stats
        await updateModelStats(env, usage);

        return json({ logged: true, id }, corsHeaders);
      }

      // Get usage history
      if (path === '/usage' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const list = await env.MEMORY.list({ prefix: 'usage:', limit });
        const usage = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? { id: k.name, ...JSON.parse(val) } : null;
          })
        );
        return json({ usage: usage.filter(Boolean).reverse() }, corsHeaders);
      }

      // Get model stats
      if (path === '/usage/stats' && method === 'GET') {
        const stats = await getModelStats(env);
        return json({ stats }, corsHeaders);
      }

      // Live usage feed (last 10)
      if (path === '/usage/live' && method === 'GET') {
        if (!env.MEMORY) return json({ error: 'KV not bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'usage:', limit: 10 });
        const usage = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? JSON.parse(val) : null;
          })
        );
        return json({ usage: usage.filter(Boolean).reverse() }, corsHeaders);
      }

      // 404
      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
      await log(env, 'error', error.message);
      return json({ error: error.message, stack: error.stack }, corsHeaders, 500);
    }
  },

  // Cron handler
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    await log(env, 'cron', `Scheduled run at ${now}`);
    await incrementStat(env, 'cron_runs');

    // Add your scheduled tasks here
    // Example: cleanup old webhooks, send reports, etc.
  }
};

// Helper functions
function json(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

async function log(env, category, message) {
  if (!env.MEMORY) return;
  const id = `log:${category}:${Date.now()}`;
  await env.MEMORY.put(id, JSON.stringify({
    timestamp: new Date().toISOString(),
    category,
    message,
  }), { expirationTtl: 86400 * 7 }); // 7 days
}

async function getStats(env) {
  if (!env.MEMORY) return {};
  const stats = await env.MEMORY.get('stats');
  return stats ? JSON.parse(stats) : {};
}

async function incrementStat(env, key) {
  if (!env.MEMORY) return;
  const stats = await getStats(env);
  stats[key] = (stats[key] || 0) + 1;
  stats.lastUpdated = new Date().toISOString();
  await env.MEMORY.put('stats', JSON.stringify(stats));
}

async function trackCloudflareUsage(env, path) {
  if (!env.MEMORY) return;
  const today = new Date().toISOString().split('T')[0];
  const key = `cf_usage:${today}`;

  try {
    const existing = await env.MEMORY.get(key);
    const usage = existing ? JSON.parse(existing) : {
      requests: 0,
      kv_reads: 0,
      kv_writes: 0,
      date: today
    };

    usage.requests++;
    // Estimate KV operations based on path
    if (path.includes('/memory') || path.includes('/usage') || path.includes('/tasks') || path.includes('/notes') || path.includes('/logs')) {
      usage.kv_reads++;
    }
    if (path.includes('/webhook') || path.includes('/usage') || path.includes('/tasks') || path.includes('/notes')) {
      usage.kv_writes++;
    }

    await env.MEMORY.put(key, JSON.stringify(usage), { expirationTtl: 86400 * 7 });
  } catch (e) {
    // Silent fail - don't break main request
  }
}

async function getCloudflareUsage(env) {
  if (!env.MEMORY) return getDefaultCfUsage();
  const today = new Date().toISOString().split('T')[0];
  const key = `cf_usage:${today}`;

  try {
    const usage = await env.MEMORY.get(key);
    return usage ? JSON.parse(usage) : getDefaultCfUsage();
  } catch (e) {
    return getDefaultCfUsage();
  }
}

function getDefaultCfUsage() {
  return {
    requests: 0,
    kv_reads: 0,
    kv_writes: 0,
    date: new Date().toISOString().split('T')[0]
  };
}

// Claude Max Usage Tracking (5-hour rolling window + weekly limit)
async function getClaudeMaxUsage(env) {
  if (!env.MEMORY) return getDefaultMaxUsage();
  const key = 'claude_max_usage';

  try {
    const data = await env.MEMORY.get(key);
    if (!data) return getDefaultMaxUsage();

    const usage = JSON.parse(data);
    const now = Date.now();
    const windowStart = usage.windowStart || now;
    const windowDuration = 5 * 60 * 60 * 1000; // 5 hours in ms
    const currentWeekStart = getWeekStart();

    // Check if 5h window has expired
    if (now - windowStart > windowDuration) {
      usage.tokensUsed = 0;
      usage.windowStart = now;
      usage.sessions = 0;
    }

    // Check if week changed
    if (!usage.weekStart || usage.weekStart < currentWeekStart) {
      usage.weeklyTokensUsed = 0;
      usage.weekStart = currentWeekStart;
    }

    // Calculate time remaining in 5h window
    const timeRemaining = windowDuration - (now - (usage.windowStart || now));
    usage.timeRemainingMs = Math.max(0, timeRemaining);
    usage.timeRemainingHours = (Math.max(0, timeRemaining) / (1000 * 60 * 60)).toFixed(1);

    // Calculate days until Monday reset
    const msUntilMonday = (currentWeekStart + 7 * 24 * 60 * 60 * 1000) - now;
    usage.daysUntilWeekReset = Math.ceil(msUntilMonday / (24 * 60 * 60 * 1000));

    // Ensure weekly fields exist
    usage.weeklyTokensUsed = usage.weeklyTokensUsed || 0;
    usage.weeklyTokensLimit = usage.weeklyTokensLimit || 400000;

    return usage;
  } catch (e) {
    return getDefaultMaxUsage();
  }
}

function getDefaultMaxUsage() {
  return {
    tokensUsed: 0,
    tokensLimit: 88000, // ~88k for Max5 plan per 5h window
    windowStart: Date.now(),
    timeRemainingMs: 5 * 60 * 60 * 1000,
    timeRemainingHours: '5.0',
    sessions: 0,
    lastSession: null,
    // Weekly tracking (resets Monday 00:00 UTC)
    weeklyTokensUsed: 0,
    weeklyTokensLimit: 400000, // ~400k/week safe estimate for Max5 (15-35h Opus)
    weekStart: getWeekStart()
  };
}

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

async function updateClaudeMaxUsage(env, tokensIn, tokensOut) {
  if (!env.MEMORY) return;
  const key = 'claude_max_usage';
  const totalTokens = tokensIn + tokensOut;

  // Read raw data to preserve windowStart
  const raw = await env.MEMORY.get(key);
  let usage;

  if (raw) {
    usage = JSON.parse(raw);
    const now = Date.now();
    const windowDuration = 5 * 60 * 60 * 1000;
    const currentWeekStart = getWeekStart();

    // Check if 5h window expired
    if (now - usage.windowStart > windowDuration) {
      // Reset window but keep weekly
      usage.tokensUsed = 0;
      usage.windowStart = now;
      usage.sessions = 0;
    }

    // Check if week changed (Monday reset)
    if (!usage.weekStart || usage.weekStart < currentWeekStart) {
      usage.weeklyTokensUsed = 0;
      usage.weekStart = currentWeekStart;
    }
  } else {
    usage = getDefaultMaxUsage();
  }

  // Add tokens to both window and weekly
  usage.tokensUsed += totalTokens;
  usage.weeklyTokensUsed = (usage.weeklyTokensUsed || 0) + totalTokens;
  usage.sessions++;
  usage.lastSession = new Date().toISOString();

  // Store
  const toStore = {
    tokensUsed: usage.tokensUsed,
    tokensLimit: usage.tokensLimit,
    windowStart: usage.windowStart,
    sessions: usage.sessions,
    lastSession: usage.lastSession,
    weeklyTokensUsed: usage.weeklyTokensUsed,
    weeklyTokensLimit: usage.weeklyTokensLimit || 400000,
    weekStart: usage.weekStart || getWeekStart()
  };

  await env.MEMORY.put(key, JSON.stringify(toStore));
}

async function getModelStats(env) {
  if (!env.MEMORY) return getDefaultModelStats();
  const stats = await env.MEMORY.get('model_stats');
  return stats ? JSON.parse(stats) : getDefaultModelStats();
}

function getDefaultModelStats() {
  return {
    providers: {
      anthropic: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      openrouter: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      z_ai: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      gemini: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      local: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
    },
    models: {},
    task_types: {},
    model_task_matrix: {},
    daily: {},
    totals: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0, savings: 0 },
    lastUpdated: new Date().toISOString(),
  };
}

async function updateModelStats(env, usage) {
  if (!env.MEMORY) return;
  const stats = await getModelStats(env);

  // Update Claude Max usage if using Anthropic/Opus
  if (usage.provider === 'anthropic' && (usage.model || '').toLowerCase().includes('opus')) {
    await updateClaudeMaxUsage(env, usage.tokens_in || 0, usage.tokens_out || 0);
  }

  // Update provider stats
  if (!stats.providers[usage.provider]) {
    stats.providers[usage.provider] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.providers[usage.provider].requests++;
  stats.providers[usage.provider].tokens_in += usage.tokens_in;
  stats.providers[usage.provider].tokens_out += usage.tokens_out;
  stats.providers[usage.provider].cost += usage.cost;

  // Update model stats
  if (!stats.models[usage.model]) {
    stats.models[usage.model] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.models[usage.model].requests++;
  stats.models[usage.model].tokens_in += usage.tokens_in;
  stats.models[usage.model].tokens_out += usage.tokens_out;
  stats.models[usage.model].cost += usage.cost;

  // Update task type stats
  if (!stats.task_types[usage.task_type]) {
    stats.task_types[usage.task_type] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.task_types[usage.task_type].requests++;
  stats.task_types[usage.task_type].tokens_in += usage.tokens_in;
  stats.task_types[usage.task_type].tokens_out += usage.tokens_out;
  stats.task_types[usage.task_type].cost += usage.cost;

  // Update model→task matrix
  if (!stats.model_task_matrix) stats.model_task_matrix = {};
  if (!stats.model_task_matrix[usage.model]) stats.model_task_matrix[usage.model] = {};
  stats.model_task_matrix[usage.model][usage.task_type] = (stats.model_task_matrix[usage.model][usage.task_type] || 0) + 1;

  // Update daily stats
  const today = new Date().toISOString().split('T')[0];
  if (!stats.daily[today]) {
    stats.daily[today] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.daily[today].requests++;
  stats.daily[today].tokens_in += usage.tokens_in;
  stats.daily[today].tokens_out += usage.tokens_out;
  stats.daily[today].cost += usage.cost;

  // Update totals
  stats.totals.requests++;
  stats.totals.tokens_in += usage.tokens_in;
  stats.totals.tokens_out += usage.tokens_out;
  stats.totals.cost += usage.cost;

  // Calculate savings (vs using Opus for everything)
  const opusCost = (usage.tokens_in * 0.015 + usage.tokens_out * 0.075) / 1000;
  stats.totals.savings += Math.max(0, opusCost - usage.cost);

  stats.lastUpdated = new Date().toISOString();
  await env.MEMORY.put('model_stats', JSON.stringify(stats));
}

function dashboardPage(stats, cfUsage = {}, maxUsage = {}) {
  const providers = stats.providers || {};
  const models = stats.models || {};
  const taskTypes = stats.task_types || {};
  const daily = stats.daily || {};
  const totals = stats.totals || { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0, savings: 0 };

  // Claude Max usage defaults (5h window)
  const maxTokensUsed = maxUsage.tokensUsed || 0;
  const maxTokensLimit = maxUsage.tokensLimit || 88000;
  const maxTimeRemaining = maxUsage.timeRemainingHours || '5.0';
  const maxSessions = maxUsage.sessions || 0;
  const maxPercentUsed = Math.min((maxTokensUsed / maxTokensLimit) * 100, 100);
  const maxTokensRemaining = Math.max(maxTokensLimit - maxTokensUsed, 0);
  const maxLastSession = maxUsage.lastSession ? new Date(maxUsage.lastSession).toLocaleTimeString() : 'Never';

  // Weekly limits
  const weeklyUsed = maxUsage.weeklyTokensUsed || 0;
  const weeklyLimit = maxUsage.weeklyTokensLimit || 400000;
  const weeklyPercent = Math.min((weeklyUsed / weeklyLimit) * 100, 100);
  const weeklyRemaining = Math.max(weeklyLimit - weeklyUsed, 0);
  const daysUntilReset = maxUsage.daysUntilWeekReset || 7;

  // Get last 7 days for chart
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    last7Days.push({
      date: key.slice(5), // MM-DD
      requests: daily[key]?.requests || 0,
      cost: daily[key]?.cost || 0,
    });
  }

  const providerColors = {
    anthropic: '#7c3aed',
    openrouter: '#10b981',
    z_ai: '#f59e0b',
    gemini: '#3b82f6',
    local: '#6b7280',
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arni Dashboard - Model Usage Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: rgba(255,255,255,0.03);
      --border: rgba(255,255,255,0.08);
      --text-primary: #f0f0f5;
      --text-secondary: #888898;
      --accent: #00ff88;
      --accent-dim: rgba(0,255,136,0.1);
      --purple: #7c3aed;
      --green: #10b981;
      --yellow: #f59e0b;
      --blue: #3b82f6;
      --red: #ef4444;
    }
    body {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }

    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .logo { display: flex; align-items: center; gap: 1rem; }
    .logo h1 {
      font-size: 1.5rem;
      font-weight: 600;
      background: linear-gradient(135deg, var(--accent), #00ccff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo span { color: var(--text-secondary); font-size: 0.9rem; }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--accent-dim);
      border: 1px solid var(--accent);
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      font-size: 0.85rem;
    }
    .status-dot {
      width: 8px; height: 8px;
      background: var(--accent);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.95)} }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--accent);
    }
    .stat-card.purple::before { background: var(--purple); }
    .stat-card.green::before { background: var(--green); }
    .stat-card.yellow::before { background: var(--yellow); }
    .stat-card.blue::before { background: var(--blue); }
    .stat-label { color: var(--text-secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .stat-value { font-size: 2rem; font-weight: 700; }
    .stat-sub { color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem; }

    /* Charts Section */
    .charts-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 900px) { .charts-grid { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
    }
    .chart-card h3 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .chart-container { position: relative; height: 250px; }

    /* Tables */
    .tables-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .table-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
    }
    .table-card h3 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-secondary); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; }
    td { font-size: 0.9rem; }
    .provider-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .provider-badge.anthropic { background: rgba(124,58,237,0.2); color: #a78bfa; }
    .provider-badge.openrouter { background: rgba(16,185,129,0.2); color: #34d399; }
    .provider-badge.z_ai { background: rgba(245,158,11,0.2); color: #fbbf24; }
    .provider-badge.gemini { background: rgba(59,130,246,0.2); color: #60a5fa; }
    .provider-badge.local { background: rgba(107,114,128,0.2); color: #9ca3af; }
    .cost { font-family: 'SF Mono', monospace; }
    .cost.free { color: var(--green); }
    .cost.low { color: var(--yellow); }
    .cost.high { color: var(--red); }

    /* Routing Config */
    .config-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .config-section h3 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .routing-tiers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .tier {
      background: var(--bg-secondary);
      border-radius: 0.75rem;
      padding: 1rem;
      border-left: 3px solid var(--accent);
    }
    .tier.tier-1 { border-color: var(--green); }
    .tier.tier-2 { border-color: var(--blue); }
    .tier.tier-3 { border-color: var(--yellow); }
    .tier.tier-4 { border-color: var(--purple); }
    .tier-name { font-weight: 600; margin-bottom: 0.5rem; }
    .tier-models { color: var(--text-secondary); font-size: 0.85rem; }
    .tier-cost { font-family: 'SF Mono', monospace; font-size: 0.8rem; margin-top: 0.5rem; color: var(--accent); }

    /* Footer */
    footer {
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.8rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    /* Savings highlight */
    .savings-highlight {
      background: linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,204,255,0.1));
      border: 1px solid var(--accent);
      border-radius: 1rem;
      padding: 1.5rem;
      text-align: center;
      margin-bottom: 2rem;
    }
    .savings-highlight .big { font-size: 3rem; font-weight: 700; color: var(--accent); }
    .savings-highlight .label { color: var(--text-secondary); margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <h1>Arni Dashboard</h1>
        <span>Model Usage Analytics</span>
      </div>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span>Live</span>
      </div>
    </header>

    <!-- Claude Max Usage (Top Priority) -->
    <div class="config-section" style="margin-bottom:1.5rem;background:linear-gradient(135deg, rgba(124,58,237,0.15), rgba(167,139,250,0.05));border:1px solid #7c3aed;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;color:#a78bfa;display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.2rem;">🟣</span> Claude Max Usage (Opus 4.5)
        </h3>
        <div style="display:flex;gap:1rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;background:rgba(124,58,237,0.2);padding:0.35rem 0.75rem;border-radius:1rem;">
            <span style="color:var(--text-secondary);font-size:0.75rem;">5h window:</span>
            <span style="color:#a78bfa;font-weight:600;">${maxTimeRemaining}h</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;background:rgba(59,130,246,0.2);padding:0.35rem 0.75rem;border-radius:1rem;">
            <span style="color:var(--text-secondary);font-size:0.75rem;">Week resets:</span>
            <span style="color:#60a5fa;font-weight:600;">${daysUntilReset}d</span>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5rem;">
        <!-- 5h Window Progress -->
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="color:var(--text-secondary);font-size:0.85rem;">⏱️ 5-Hour Window</span>
            <span style="font-size:0.8rem;color:${maxPercentUsed > 80 ? '#ef4444' : maxPercentUsed > 50 ? '#f59e0b' : '#10b981'};">${maxPercentUsed.toFixed(0)}%</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-size:1.75rem;font-weight:700;color:${maxPercentUsed > 80 ? '#ef4444' : maxPercentUsed > 50 ? '#f59e0b' : '#a78bfa'};">${formatTokens(maxTokensUsed)}</span>
            <span style="color:var(--text-secondary);font-size:0.85rem;">/ ${formatTokens(maxTokensLimit)}</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin-bottom:0.5rem;">
            <div style="height:100%;width:${maxPercentUsed}%;background:linear-gradient(90deg, #7c3aed, ${maxPercentUsed > 80 ? '#ef4444' : maxPercentUsed > 50 ? '#f59e0b' : '#a78bfa'});"></div>
          </div>
          <div style="font-size:0.8rem;color:#10b981;">${formatTokens(maxTokensRemaining)} remaining</div>
        </div>

        <!-- Weekly Progress -->
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="color:var(--text-secondary);font-size:0.85rem;">📅 Weekly Limit</span>
            <span style="font-size:0.8rem;color:${weeklyPercent > 80 ? '#ef4444' : weeklyPercent > 50 ? '#f59e0b' : '#10b981'};">${weeklyPercent.toFixed(0)}%</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-size:1.75rem;font-weight:700;color:${weeklyPercent > 80 ? '#ef4444' : weeklyPercent > 50 ? '#f59e0b' : '#3b82f6'};">${formatTokens(weeklyUsed)}</span>
            <span style="color:var(--text-secondary);font-size:0.85rem;">/ ${formatTokens(weeklyLimit)}</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin-bottom:0.5rem;">
            <div style="height:100%;width:${weeklyPercent}%;background:linear-gradient(90deg, #3b82f6, ${weeklyPercent > 80 ? '#ef4444' : weeklyPercent > 50 ? '#f59e0b' : '#60a5fa'});"></div>
          </div>
          <div style="font-size:0.8rem;color:#10b981;">${formatTokens(weeklyRemaining)} remaining this week</div>
        </div>

        <!-- Live Activity Feed -->
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
            <span style="color:var(--text-secondary);font-size:0.85rem;">📡 Live Activity</span>
            <span id="liveIndicator" style="width:8px;height:8px;background:#10b981;border-radius:50%;animation:pulse 2s infinite;"></span>
          </div>
          <div id="liveActivityFeed" style="font-size:0.75rem;max-height:120px;overflow-y:auto;">
            <div style="color:var(--text-secondary);text-align:center;padding:1rem;">Loading...</div>
          </div>
          <button onclick="showFullLog()" style="margin-top:0.5rem;width:100%;padding:0.5rem;background:rgba(124,58,237,0.2);border:1px solid #7c3aed;border-radius:0.5rem;color:#a78bfa;cursor:pointer;font-size:0.75rem;">View Full Log →</button>
        </div>
      </div>

      <!-- Quick Stats Row -->
      <div style="display:flex;gap:1rem;margin-top:1rem;">
        <div style="flex:1;background:var(--bg-secondary);padding:0.75rem;border-radius:0.5rem;text-align:center;">
          <div style="color:var(--text-secondary);font-size:0.7rem;">SESSIONS</div>
          <div style="font-size:1.1rem;font-weight:600;color:var(--text-primary);">${maxSessions}</div>
        </div>
        <div style="flex:1;background:var(--bg-secondary);padding:0.75rem;border-radius:0.5rem;text-align:center;">
          <div style="color:var(--text-secondary);font-size:0.7rem;">LAST ACTIVE</div>
          <div style="font-size:0.9rem;color:var(--text-primary);">${maxLastSession}</div>
        </div>
        <div style="flex:1;background:var(--bg-secondary);padding:0.75rem;border-radius:0.5rem;text-align:center;">
          <div style="color:var(--text-secondary);font-size:0.7rem;">STATUS</div>
          <div style="font-size:0.9rem;color:${maxPercentUsed > 90 || weeklyPercent > 90 ? '#ef4444' : '#10b981'};">${maxPercentUsed > 90 || weeklyPercent > 90 ? '⚠️ Near Limit' : '✅ Available'}</div>
        </div>
      </div>

      <!-- Proactive Usage Suggestion -->
      ${Math.min(maxTokensRemaining, weeklyRemaining) > 20000 ? renderProactiveBox(Math.min(maxTokensRemaining, weeklyRemaining)) : ''}
    </div>

    <!-- Monthly Subscriptions Summary -->
    <div class="savings-highlight">
      <div class="big">$103/mo</div>
      <div class="label">Total Monthly Subscriptions</div>
      <div style="margin-top:1rem;display:flex;justify-content:center;gap:2rem;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:1.5rem;color:#a78bfa;">$100</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">Claude Max</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:1.5rem;color:#fbbf24;">$3</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">Z.ai GLM</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:1.5rem;color:#34d399;">FREE</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">Gemini</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:1.5rem;color:#34d399;">FREE</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">OpenRouter</div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value">${totals.requests.toLocaleString()}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">Tokens In</div>
        <div class="stat-value">${formatTokens(totals.tokens_in)}</div>
        <div class="stat-sub">Input tokens</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Tokens Out</div>
        <div class="stat-value">${formatTokens(totals.tokens_out)}</div>
        <div class="stat-sub">Output tokens</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value">$${totals.cost.toFixed(4)}</div>
        <div class="stat-sub">Actual spend</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-card">
        <h3>Usage Over Time (7 Days)</h3>
        <div class="chart-container">
          <canvas id="usageChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h3>By Provider</h3>
        <div class="chart-container">
          <canvas id="providerChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Model → Task Matrix -->
    <div class="table-card" style="margin-bottom: 2rem;">
      <h3>🎯 Model → Task Type Usage</h3>
      <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.9rem;">Which models are used for which types of work</p>
      ${renderModelTaskMatrix(models, taskTypes, stats.model_task_matrix || {})}
    </div>

    <!-- Routing Config -->
    <div class="config-section">
      <h3>Active Routing Configuration</h3>
      <div class="routing-tiers">
        <div class="tier tier-1">
          <div class="tier-name">🟢 Tier 1 - Simple</div>
          <div class="tier-models">OpenRouter free, Gemini Flash</div>
          <div class="tier-cost" style="color:#34d399;">FREE</div>
        </div>
        <div class="tier tier-2">
          <div class="tier-name">🔵 Tier 2 - Coding</div>
          <div class="tier-models">GLM-4.6 via Z.ai</div>
          <div class="tier-cost" style="color:#fbbf24;">$3/mo subscription</div>
        </div>
        <div class="tier tier-3">
          <div class="tier-name">🟡 Tier 3 - Complex</div>
          <div class="tier-models">GLM-4.7 via Z.ai, Gemini Pro</div>
          <div class="tier-cost" style="color:#fbbf24;">$3/mo + Gemini free</div>
        </div>
        <div class="tier tier-4">
          <div class="tier-name">🟣 Tier 4 - Critical/Strategic</div>
          <div class="tier-models">Claude Opus 4.5</div>
          <div class="tier-cost" style="color:#a78bfa;">$100/mo subscription</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.5rem;">Business planning • Architecture • Security • Agent orchestration</div>
        </div>
      </div>
    </div>

    <!-- Tables -->
    <div class="tables-grid">
      <div class="table-card">
        <h3>By Provider</h3>
        <table>
          <thead>
            <tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
          </thead>
          <tbody>
            ${renderProviderRows(providers)}
          </tbody>
        </table>
      </div>
      <div class="table-card">
        <h3>By Task Type</h3>
        <table>
          <thead>
            <tr><th>Type</th><th>Requests</th><th>Cost</th></tr>
          </thead>
          <tbody>
            ${renderTaskTypeRows(taskTypes)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Top Models -->
    <div class="table-card">
      <h3>Top Models</h3>
      <table>
        <thead>
          <tr><th>Model</th><th>Requests</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th></tr>
        </thead>
        <tbody>
          ${renderModelRows(models)}
        </tbody>
      </table>
    </div>

    <!-- Cloudflare Usage -->
    <div class="config-section" style="margin-top:2rem;">
      <h3>☁️ Cloudflare Free Tier Usage (Today)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-top:1rem;">
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:var(--text-secondary);">Workers Requests</span>
            <span style="font-size:0.75rem;color:${(cfUsage.requests || 0) > 80000 ? '#ef4444' : (cfUsage.requests || 0) > 50000 ? '#f59e0b' : '#10b981'};">${((cfUsage.requests || 0) / 100000 * 100).toFixed(1)}%</span>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${(cfUsage.requests || 0).toLocaleString()}</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">of 100,000/day FREE</div>
          <div style="margin-top:0.5rem;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min((cfUsage.requests || 0) / 100000 * 100, 100)}%;background:${(cfUsage.requests || 0) > 80000 ? '#ef4444' : (cfUsage.requests || 0) > 50000 ? '#f59e0b' : '#10b981'};"></div>
          </div>
        </div>
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:var(--text-secondary);">KV Reads</span>
            <span style="font-size:0.75rem;color:${(cfUsage.kv_reads || 0) > 80000 ? '#ef4444' : (cfUsage.kv_reads || 0) > 50000 ? '#f59e0b' : '#10b981'};">${((cfUsage.kv_reads || 0) / 100000 * 100).toFixed(1)}%</span>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${(cfUsage.kv_reads || 0).toLocaleString()}</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">of 100,000/day FREE</div>
          <div style="margin-top:0.5rem;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min((cfUsage.kv_reads || 0) / 100000 * 100, 100)}%;background:${(cfUsage.kv_reads || 0) > 80000 ? '#ef4444' : (cfUsage.kv_reads || 0) > 50000 ? '#f59e0b' : '#10b981'};"></div>
          </div>
        </div>
        <div style="background:var(--bg-secondary);padding:1rem;border-radius:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:var(--text-secondary);">KV Writes</span>
            <span style="font-size:0.75rem;color:${(cfUsage.kv_writes || 0) > 800 ? '#ef4444' : (cfUsage.kv_writes || 0) > 500 ? '#f59e0b' : '#10b981'};">${((cfUsage.kv_writes || 0) / 1000 * 100).toFixed(1)}%</span>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${(cfUsage.kv_writes || 0).toLocaleString()}</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);">of 1,000/day FREE</div>
          <div style="margin-top:0.5rem;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${Math.min((cfUsage.kv_writes || 0) / 1000 * 100, 100)}%;background:${(cfUsage.kv_writes || 0) > 800 ? '#ef4444' : (cfUsage.kv_writes || 0) > 500 ? '#f59e0b' : '#10b981'};"></div>
          </div>
        </div>
      </div>
      <div style="margin-top:1rem;font-size:0.8rem;color:var(--text-secondary);text-align:center;">
        🟢 &lt;50% | 🟡 50-80% | 🔴 &gt;80% — Resets daily at midnight UTC
      </div>
    </div>

    <footer>
      <p>Arni v2.7.0 | <a href="/">API Docs</a> | Last updated: ${stats.lastUpdated || 'Never'}</p>
    </footer>
  </div>

  <script>
    // Usage Chart
    const usageCtx = document.getElementById('usageChart').getContext('2d');
    new Chart(usageCtx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(last7Days.map(d => d.date))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(last7Days.map(d => d.requests))},
          borderColor: '#00ff88',
          backgroundColor: 'rgba(0,255,136,0.1)',
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
          x: { grid: { display: false }, ticks: { color: '#888' } }
        }
      }
    });

    // Provider Chart
    const providerCtx = document.getElementById('providerChart').getContext('2d');
    new Chart(providerCtx, {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(Object.keys(providers))},
        datasets: [{
          data: ${JSON.stringify(Object.values(providers).map(p => p.requests))},
          backgroundColor: ['#7c3aed', '#10b981', '#f59e0b', '#3b82f6', '#6b7280'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#888', padding: 15 } }
        }
      }
    });

    // Live Activity Feed
    const providerColors = {
      anthropic: '#a78bfa',
      openrouter: '#34d399',
      z_ai: '#fbbf24',
      gemini: '#60a5fa',
      local: '#9ca3af'
    };

    async function loadLiveFeed() {
      try {
        const res = await fetch('/usage/live');
        const data = await res.json();
        const feed = document.getElementById('liveActivityFeed');
        if (data.usage && data.usage.length > 0) {
          feed.innerHTML = data.usage.slice(0, 5).map(u => {
            const time = new Date(u.timestamp).toLocaleTimeString();
            const color = providerColors[u.provider] || '#888';
            const tokens = ((u.tokens_in || 0) + (u.tokens_out || 0)).toLocaleString();
            return '<div style="padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">' +
              '<div><span style="color:' + color + ';font-weight:500;">' + (u.model || 'unknown').split('/').pop().slice(0,15) + '</span></div>' +
              '<div style="display:flex;gap:0.5rem;align-items:center;">' +
                '<span style="color:var(--text-secondary);">' + tokens + '</span>' +
                '<span style="color:var(--text-secondary);font-size:0.65rem;">' + time + '</span>' +
              '</div>' +
            '</div>';
          }).join('');
        } else {
          feed.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:1rem;">No activity yet</div>';
        }
      } catch (e) {
        console.error('Live feed error:', e);
      }
    }

    // Load immediately and refresh every 30s
    loadLiveFeed();
    setInterval(loadLiveFeed, 30000);

    // Full Log Modal
    function showFullLog() {
      const modal = document.createElement('div');
      modal.id = 'logModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
      modal.innerHTML = '<div style="background:#12121a;border:1px solid rgba(255,255,255,0.1);border-radius:1rem;width:90%;max-width:800px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">' +
        '<div style="padding:1rem;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 style="margin:0;color:#a78bfa;">📋 Full Usage Log</h3>' +
          '<button onclick="closeModal()" style="background:none;border:none;color:#888;font-size:1.5rem;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div id="fullLogContent" style="padding:1rem;overflow-y:auto;flex:1;">Loading...</div>' +
      '</div>';
      document.body.appendChild(modal);
      modal.onclick = (e) => { if (e.target === modal) closeModal(); };
      loadFullLog();
    }

    function closeModal() {
      const modal = document.getElementById('logModal');
      if (modal) modal.remove();
    }

    async function loadFullLog() {
      try {
        const res = await fetch('/usage?limit=50');
        const data = await res.json();
        const content = document.getElementById('fullLogContent');
        if (data.usage && data.usage.length > 0) {
          content.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
            '<thead><tr style="color:var(--text-secondary);text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">' +
              '<th style="padding:0.5rem;">Time</th><th>Provider</th><th>Model</th><th>Task</th><th>Tokens</th>' +
            '</tr></thead><tbody>' +
            data.usage.map(u => {
              const time = new Date(u.timestamp).toLocaleString();
              const color = providerColors[u.provider] || '#888';
              return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                '<td style="padding:0.5rem;color:var(--text-secondary);">' + time + '</td>' +
                '<td><span style="color:' + color + ';">' + u.provider + '</span></td>' +
                '<td style="font-family:monospace;">' + (u.model || '-') + '</td>' +
                '<td>' + (u.task_type || '-') + '</td>' +
                '<td>' + ((u.tokens_in||0)+(u.tokens_out||0)).toLocaleString() + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table>';
        } else {
          content.innerHTML = '<div style="text-align:center;color:var(--text-secondary);">No usage data</div>';
        }
      } catch (e) {
        document.getElementById('fullLogContent').innerHTML = '<div style="color:#ef4444;">Error loading log</div>';
      }
    }
  </script>
</body>
</html>`;
}

function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function renderProviderRows(providers) {
  const costInfo = {
    anthropic: { text: '$100/mo', type: 'subscription', class: 'high' },
    z_ai: { text: '$3/mo', type: 'subscription', class: 'low' },
    gemini: { text: 'FREE', type: 'free tier', class: 'free' },
    openrouter: { text: 'FREE', type: 'free models', class: 'free' },
    local: { text: 'FREE', type: 'local', class: 'free' },
  };
  return Object.entries(providers).map(([name, data]) => {
    const info = costInfo[name] || { text: 'Unknown', type: '', class: '' };
    const tokens = formatTokens(data.tokens_in + data.tokens_out);
    const typeLabel = info.type ? '<span style="font-size:0.7rem;color:var(--text-secondary);display:block;">' + info.type + '</span>' : '';
    return '<tr><td><span class="provider-badge ' + name + '">' + name + '</span></td><td>' + data.requests.toLocaleString() + '</td><td>' + tokens + '</td><td class="cost ' + info.class + '">' + info.text + typeLabel + '</td></tr>';
  }).join('');
}

function renderTaskTypeRows(taskTypes) {
  return Object.entries(taskTypes).map(([type, data]) => {
    const costText = data.cost === 0 ? 'FREE' : '$' + data.cost.toFixed(4);
    return '<tr><td>' + type + '</td><td>' + data.requests.toLocaleString() + '</td><td class="cost">' + costText + '</td></tr>';
  }).join('');
}

function renderModelRows(models) {
  return Object.entries(models)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 10)
    .map(([model, data]) => {
      const costClass = data.cost === 0 ? 'free' : data.cost < 0.01 ? 'low' : 'high';
      const costText = data.cost === 0 ? 'FREE' : '$' + data.cost.toFixed(4);
      return '<tr><td><code>' + model + '</code></td><td>' + data.requests.toLocaleString() + '</td><td>' + formatTokens(data.tokens_in) + '</td><td>' + formatTokens(data.tokens_out) + '</td><td class="cost ' + costClass + '">' + costText + '</td></tr>';
    }).join('');
}

function renderProactiveBox(tokensRemaining) {
  const canDoTasks = [];
  if (tokensRemaining >= 50000) canDoTasks.push('Deep architecture review');
  if (tokensRemaining >= 40000) canDoTasks.push('Comprehensive code audit');
  if (tokensRemaining >= 30000) canDoTasks.push('Complex feature planning');
  if (tokensRemaining >= 20000) canDoTasks.push('Security analysis');
  if (tokensRemaining >= 10000) canDoTasks.push('Agent orchestration task');

  const suggestions = canDoTasks.slice(0, 3);
  if (suggestions.length === 0) return '';

  return '<div style="margin-top:1rem;padding:1rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:0.75rem;">' +
    '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">' +
      '<span style="color:#10b981;font-weight:600;">Proactive Usage Available</span>' +
      '<span style="background:#10b981;color:#000;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:1rem;">Use remaining quota</span>' +
    '</div>' +
    '<div style="color:var(--text-secondary);font-size:0.85rem;">With ' + formatTokens(tokensRemaining) + ' tokens remaining, you can still do:</div>' +
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">' +
      suggestions.map(function(s) { return '<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:0.25rem 0.75rem;border-radius:1rem;font-size:0.8rem;">' + s + '</span>'; }).join('') +
    '</div>' +
  '</div>';
}

function renderModelTaskMatrix(models, taskTypes, matrix) {
  // Build matrix from stored data or show placeholder
  const modelList = Object.keys(models).slice(0, 8);
  const taskList = Object.keys(taskTypes).slice(0, 6);

  if (modelList.length === 0 || taskList.length === 0) {
    return '<div style="text-align:center;color:var(--text-secondary);padding:2rem;">No usage data yet. Start using models to see the matrix.</div>';
  }

  let html = '<div style="overflow-x:auto;"><table style="min-width:600px;">';
  html += '<thead><tr><th>Model</th>';
  taskList.forEach(task => {
    html += '<th style="text-align:center;font-size:0.75rem;">' + task + '</th>';
  });
  html += '</tr></thead><tbody>';

  modelList.forEach(model => {
    const modelData = matrix[model] || {};
    html += '<tr><td><code style="font-size:0.8rem;">' + model.split('/').pop() + '</code></td>';
    taskList.forEach(task => {
      const count = modelData[task] || 0;
      const intensity = Math.min(count / 10, 1);
      const bg = count > 0 ? 'rgba(0,255,136,' + (0.1 + intensity * 0.4) + ')' : 'transparent';
      html += '<td style="text-align:center;background:' + bg + ';font-size:0.85rem;">' + (count || '-') + '</td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function statusPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arni - Autonomous Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 3rem; color: #00ff88; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(0,255,136,0.1);
      border: 1px solid #00ff88;
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      margin-bottom: 2rem;
    }
    .dot {
      width: 10px; height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    .section {
      background: rgba(255,255,255,0.05);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .section h2 {
      color: #00ff88;
      font-size: 1rem;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .endpoint {
      display: flex;
      gap: 1rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .endpoint:last-child { border-bottom: none; }
    .method {
      font-weight: bold;
      min-width: 60px;
      color: #00ff88;
    }
    .method.post { color: #ff9800; }
    .method.put { color: #2196f3; }
    .method.delete { color: #f44336; }
    .path { color: #fff; font-family: monospace; }
    .desc { color: #888; font-size: 0.9rem; margin-left: auto; }
    .footer { text-align: center; color: #666; margin-top: 2rem; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Arni</h1>
    <p class="subtitle">Autonomous Agent Platform</p>
    <div class="status"><span class="dot"></span><span>Online</span></div>

    <div class="section" style="background: linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,204,255,0.05)); border: 1px solid #00ff88;">
      <h2>📊 Dashboard</h2>
      <p style="margin-bottom: 1rem; color: #ccc;">Visual analytics for model usage, costs, and savings</p>
      <a href="/dashboard" style="display: inline-block; background: #00ff88; color: #000; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold;">Open Dashboard →</a>
    </div>

    <div class="section">
      <h2>Status</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/health</span><span class="desc">Health check + stats</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/stats</span><span class="desc">Usage statistics</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/api/ping</span><span class="desc">Ping</span></div>
    </div>

    <div class="section">
      <h2>Webhooks</h2>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/webhook</span><span class="desc">Receive webhook</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/webhooks</span><span class="desc">List received webhooks</span></div>
    </div>

    <div class="section">
      <h2>Memory (KV)</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/memory</span><span class="desc">List keys</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/memory/:key</span><span class="desc">Read value</span></div>
      <div class="endpoint"><span class="method put">PUT</span><span class="path">/memory/:key</span><span class="desc">Store value</span></div>
      <div class="endpoint"><span class="method delete">DEL</span><span class="path">/memory/:key</span><span class="desc">Delete value</span></div>
    </div>

    <div class="section">
      <h2>Tasks</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/tasks</span><span class="desc">List tasks</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/tasks</span><span class="desc">Create task</span></div>
      <div class="endpoint"><span class="method put">PUT</span><span class="path">/tasks/:id</span><span class="desc">Update task</span></div>
      <div class="endpoint"><span class="method delete">DEL</span><span class="path">/tasks/:id</span><span class="desc">Delete task</span></div>
    </div>

    <div class="section">
      <h2>Notes</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/notes</span><span class="desc">List notes</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/notes</span><span class="desc">Create note</span></div>
      <div class="endpoint"><span class="method put">PUT</span><span class="path">/notes/:id</span><span class="desc">Update note</span></div>
      <div class="endpoint"><span class="method delete">DEL</span><span class="path">/notes/:id</span><span class="desc">Delete note</span></div>
    </div>

    <div class="section">
      <h2>System</h2>
      <div class="endpoint"><span class="method">GET</span><span class="path">/logs</span><span class="desc">Activity logs</span></div>
      <div class="endpoint"><span class="method">GET</span><span class="path">/config</span><span class="desc">Get config</span></div>
      <div class="endpoint"><span class="method put">PUT</span><span class="path">/config</span><span class="desc">Update config</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="path">/proxy</span><span class="desc">HTTP proxy</span></div>
    </div>

    <p class="footer">v2.1.0 | Cloudflare Workers + KV | <a href="/dashboard" style="color:#00ff88">Dashboard</a></p>
  </div>
</body>
</html>`;
}
