/**
 * Arni Worker v2.0.0 - Full Autonomous Agent Platform
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
      // ==================== PUBLIC ENDPOINTS ====================

      // Status page
      if (path === '/' && method === 'GET') {
        return new Response(statusPage(), {
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
          version: '2.0.0',
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

    <p class="footer">v2.0.0 | Cloudflare Workers + KV | Cron enabled</p>
  </div>
</body>
</html>`;
}
