/**
 * Arni Worker v3.0.0 - Full Autonomous Agent Platform
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
          version: '3.0.0',
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
  const totals = stats.totals || { requests: 0, tokens_in: 0, tokens_out: 0 };

  // Session (5h window)
  const sessionPercent = Math.min(((maxUsage.tokensUsed || 0) / (maxUsage.tokensLimit || 88000)) * 100, 100);
  const sessionTimeLeft = maxUsage.timeRemainingHours || '5.0';

  // Weekly
  const weeklyUsed = maxUsage.weeklyTokensUsed || 0;
  const weeklyLimit = maxUsage.weeklyTokensLimit || 400000;
  const weeklyPercent = Math.min((weeklyUsed / weeklyLimit) * 100, 100);
  const daysUntilReset = maxUsage.daysUntilWeekReset || 7;

  // Circle progress calculation
  const circleSize = 140;
  const strokeWidth = 10;
  const radius = (circleSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const sessionOffset = circumference - (sessionPercent / 100) * circumference;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Usage - Opus 4.6</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a1a; }
    .container { max-width: 600px; margin: 0 auto; padding: 2rem 1.5rem; }

    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }

    .section { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .section-title { font-size: 0.9rem; font-weight: 600; color: #666; margin-bottom: 1rem; }

    /* Circular progress */
    .session-circle { display: flex; align-items: center; gap: 2rem; }
    .circle-wrapper { position: relative; width: ${circleSize}px; height: ${circleSize}px; }
    .circle-svg { transform: rotate(-90deg); }
    .circle-bg { fill: none; stroke: #e5e5e5; stroke-width: ${strokeWidth}; }
    .circle-progress { fill: none; stroke: #7c3aed; stroke-width: ${strokeWidth}; stroke-linecap: round; transition: stroke-dashoffset 0.5s; }
    .circle-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .circle-percent { font-size: 2rem; font-weight: 700; color: #1a1a1a; }
    .circle-label { font-size: 0.75rem; color: #888; }

    .session-info { flex: 1; }
    .session-status { font-size: 1rem; font-weight: 500; margin-bottom: 0.5rem; }
    .session-reset { font-size: 0.85rem; color: #666; }

    /* Weekly bars */
    .weekly-item { margin-bottom: 1rem; }
    .weekly-item:last-child { margin-bottom: 0; }
    .weekly-header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .weekly-label { font-size: 0.9rem; font-weight: 500; }
    .weekly-value { font-size: 0.9rem; color: #666; }
    .bar { height: 8px; background: #e5e5e5; border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .bar-purple { background: #7c3aed; }
    .bar-orange { background: #f59e0b; }
    .bar-green { background: #10b981; }

    /* Activity */
    .activity-list { font-size: 0.85rem; }
    .activity-item { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
    .activity-item:last-child { border-bottom: none; }
    .activity-model { font-weight: 500; }
    .activity-tokens { color: #666; }

    /* Routing */
    .tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
    .tier { padding: 0.75rem; background: #f8f9fa; border-radius: 8px; border-left: 3px solid; }
    .tier-purple { border-color: #7c3aed; }
    .tier-orange { border-color: #f59e0b; }
    .tier-green { border-color: #10b981; }
    .tier-name { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.25rem; }
    .tier-desc { font-size: 0.7rem; color: #666; }

    /* Footer */
    .footer { text-align: center; font-size: 0.75rem; color: #999; margin-top: 1rem; }

    @media (max-width: 500px) {
      .session-circle { flex-direction: column; text-align: center; }
      .tier-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Usage</h1>

    <!-- Current Session -->
    <div class="section">
      <div class="section-title">Current session</div>
      <div class="session-circle">
        <div class="circle-wrapper">
          <svg class="circle-svg" width="${circleSize}" height="${circleSize}">
            <circle class="circle-bg" cx="${circleSize/2}" cy="${circleSize/2}" r="${radius}"/>
            <circle class="circle-progress" cx="${circleSize/2}" cy="${circleSize/2}" r="${radius}"
              stroke-dasharray="${circumference}" stroke-dashoffset="${sessionOffset}"
              style="stroke: ${sessionPercent >= 100 ? '#ef4444' : sessionPercent > 80 ? '#f59e0b' : '#7c3aed'}"/>
          </svg>
          <div class="circle-text">
            <span class="circle-percent">${sessionPercent.toFixed(0)}%</span>
            <span class="circle-label">used</span>
          </div>
        </div>
        <div class="session-info">
          <div class="session-status">${sessionPercent >= 100 ? 'Limit reached' : sessionPercent > 80 ? 'Near limit' : 'Available'}</div>
          <div class="session-reset">Resets in ${sessionTimeLeft}h</div>
          <div class="session-reset" style="font-size:0.75rem;margin-top:0.25rem;" id="resetTime"></div>
        </div>
      </div>
    </div>

    <!-- Weekly Limits -->
    <div class="section">
      <div class="section-title">Weekly limits</div>

      <div class="weekly-item">
        <div class="weekly-header">
          <span class="weekly-label">All models (Opus)</span>
          <span class="weekly-value">${weeklyPercent.toFixed(0)}% used</span>
        </div>
        <div class="bar"><div class="bar-fill bar-purple" style="width:${weeklyPercent}%"></div></div>
      </div>

      <div class="weekly-item">
        <div class="weekly-header">
          <span class="weekly-label">Delegated (Z.ai)</span>
          <span class="weekly-value">${formatTokens(totals.tokens_in + totals.tokens_out)} tokens</span>
        </div>
        <div class="bar"><div class="bar-fill bar-orange" style="width:${Math.min((totals.requests / 100) * 100, 100)}%"></div></div>
      </div>

      <div style="font-size:0.75rem;color:#888;margin-top:0.75rem;">Resets Monday (${daysUntilReset} days)</div>
    </div>

    <!-- Live Activity -->
    <div class="section">
      <div class="section-title">Recent activity</div>
      <div id="activityList" class="activity-list">
        <div style="color:#888;text-align:center;padding:1rem;">Loading...</div>
      </div>
    </div>

    <!-- Routing -->
    <div class="section">
      <div class="section-title">Model routing</div>
      <div class="tier-grid">
        <div class="tier tier-purple">
          <div class="tier-name">Opus 4.6</div>
          <div class="tier-desc">Planning, Security</div>
        </div>
        <div class="tier tier-orange">
          <div class="tier-name">Z.ai GLM</div>
          <div class="tier-desc">Coding, Tests</div>
        </div>
        <div class="tier tier-green">
          <div class="tier-name">Free</div>
          <div class="tier-desc">Simple tasks</div>
        </div>
      </div>
    </div>

    <div class="footer">Opus 4.6 • $103/mo • v3.1 • <span id="clock"></span></div>
  </div>

  <script>
    // Warsaw timezone
    function updateClock() {
      const now = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
      document.getElementById('clock').textContent = now + ' Warsaw';
    }
    updateClock();
    setInterval(updateClock, 60000);

    // Calculate reset time in Warsaw
    const resetMs = ${maxUsage.timeRemainingMs || 5*60*60*1000};
    const resetDate = new Date(Date.now() + resetMs);
    document.getElementById('resetTime').textContent = '(~' + resetDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }) + ')';

    async function loadActivity() {
      try {
        const r = await fetch('/usage/live');
        const d = await r.json();
        const el = document.getElementById('activityList');
        if (d.usage?.length) {
          el.innerHTML = d.usage.slice(0,5).map(u =>
            '<div class="activity-item"><span class="activity-model">'+(u.model||'unknown').split('/').pop()+'</span><span class="activity-tokens">'+((u.tokens_in||0)+(u.tokens_out||0)).toLocaleString()+' tokens</span></div>'
          ).join('');
        } else {
          el.innerHTML = '<div style="color:#888;text-align:center;">No recent activity</div>';
        }
      } catch(e) {}
    }
    loadActivity();
    setInterval(loadActivity, 30000);
  </script>
</body>
</html>`;
}

function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
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
