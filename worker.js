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

      // ==================== HEALTH CHECK ====================

      // Manual VPS health check
      if (path === '/api/health/vps' && method === 'GET') {
        try {
          const start = Date.now();
          const response = await fetch('http://161.97.121.62:18799/health', {
            signal: AbortSignal.timeout(10000)
          });
          const latency = Date.now() - start;
          const data = await response.json().catch(() => ({}));

          return json({
            status: response.ok ? 'ok' : 'error',
            latency_ms: latency,
            http_status: response.status,
            vps_response: data
          }, corsHeaders);
        } catch (e) {
          return json({
            status: 'unreachable',
            error: e.message
          }, corsHeaders, 503);
        }
      }

      // Health check history
      if (path === '/api/health/history' && method === 'GET') {
        if (!env.DB) return json({ error: 'D1 not configured' }, corsHeaders, 500);
        const result = await env.DB.prepare(
          "SELECT * FROM logs WHERE category = 'health' ORDER BY id DESC LIMIT 50"
        ).all();
        return json({ checks: result.results }, corsHeaders);
      }

      // ==================== QUEUE API ====================

      // Add job to queue
      if (path === '/api/queue' && method === 'POST') {
        if (!env.JOBS_QUEUE) return json({ error: 'Queue not configured' }, corsHeaders, 500);
        const body = await request.json();
        await env.JOBS_QUEUE.send(body);
        await log(env, 'queue', `Job queued: ${body.type}`);
        return json({ queued: true, job: body.type }, corsHeaders);
      }

      // Get queue status
      if (path === '/api/queue/status' && method === 'GET') {
        if (!env.DB) return json({ error: 'D1 not configured' }, corsHeaders, 500);
        const result = await env.DB.prepare(
          "SELECT * FROM logs WHERE category = 'queue' ORDER BY id DESC LIMIT 20"
        ).all();
        return json({ jobs: result.results }, corsHeaders);
      }

      // ==================== NOTION API ====================

      // Search Notion databases
      if (path === '/api/notion/search' && method === 'POST') {
        if (!env.NOTION_API_KEY) return json({ error: 'Notion not configured' }, corsHeaders, 500);
        const body = await request.json();
        const response = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // Query Notion database
      if (path.startsWith('/api/notion/database/') && method === 'POST') {
        if (!env.NOTION_API_KEY) return json({ error: 'Notion not configured' }, corsHeaders, 500);
        const dbId = path.replace('/api/notion/database/', '').replace('/query', '');
        const body = await request.json();
        const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // Get/Create Notion page
      if (path.startsWith('/api/notion/page/') && method === 'GET') {
        if (!env.NOTION_API_KEY) return json({ error: 'Notion not configured' }, corsHeaders, 500);
        const pageId = path.replace('/api/notion/page/', '');
        const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
          },
        });
        const data = await response.json();
        return json(data, corsHeaders);
      }

      if (path === '/api/notion/pages' && method === 'POST') {
        if (!env.NOTION_API_KEY) return json({ error: 'Notion not configured' }, corsHeaders, 500);
        const body = await request.json();
        const response = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // ==================== R2 STORAGE ====================

      // Upload file to R2
      if (path.startsWith('/api/storage/') && method === 'PUT') {
        if (!env.STORAGE) return json({ error: 'R2 not configured' }, corsHeaders, 500);
        const key = path.replace('/api/storage/', '');
        const body = await request.arrayBuffer();
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        await env.STORAGE.put(key, body, { httpMetadata: { contentType } });
        return json({ uploaded: true, key, size: body.byteLength }, corsHeaders);
      }

      // Get file from R2
      if (path.startsWith('/api/storage/') && method === 'GET') {
        if (!env.STORAGE) return json({ error: 'R2 not configured' }, corsHeaders, 500);
        const key = path.replace('/api/storage/', '');
        const object = await env.STORAGE.get(key);
        if (!object) return json({ error: 'Not found' }, corsHeaders, 404);
        const headers = new Headers(corsHeaders);
        headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Length', object.size);
        return new Response(object.body, { headers });
      }

      // Delete file from R2
      if (path.startsWith('/api/storage/') && method === 'DELETE') {
        if (!env.STORAGE) return json({ error: 'R2 not configured' }, corsHeaders, 500);
        const key = path.replace('/api/storage/', '');
        await env.STORAGE.delete(key);
        return json({ deleted: true, key }, corsHeaders);
      }

      // List files in R2
      if (path === '/api/storage' && method === 'GET') {
        if (!env.STORAGE) return json({ error: 'R2 not configured' }, corsHeaders, 500);
        const prefix = url.searchParams.get('prefix') || '';
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const list = await env.STORAGE.list({ prefix, limit });
        return json({
          objects: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
          truncated: list.truncated
        }, corsHeaders);
      }

      // ==================== FAKTUROWNIA API ====================

      // List invoices
      if (path === '/api/invoices' && method === 'GET') {
        if (!env.FAKTUROWNIA_USER || !env.FAKTUROWNIA_TOKEN) return json({ error: 'Fakturownia not configured' }, corsHeaders, 500);
        const page = url.searchParams.get('page') || '1';
        const response = await fetch(`https://${env.FAKTUROWNIA_USER}.fakturownia.pl/invoices.json?page=${page}&api_token=${env.FAKTUROWNIA_TOKEN}`);
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // Get single invoice
      if (path.match(/^\/api\/invoices\/\d+$/) && method === 'GET') {
        if (!env.FAKTUROWNIA_USER || !env.FAKTUROWNIA_TOKEN) return json({ error: 'Fakturownia not configured' }, corsHeaders, 500);
        const invoiceId = path.replace('/api/invoices/', '');
        const response = await fetch(`https://${env.FAKTUROWNIA_USER}.fakturownia.pl/invoices/${invoiceId}.json?api_token=${env.FAKTUROWNIA_TOKEN}`);
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // Create invoice
      if (path === '/api/invoices' && method === 'POST') {
        if (!env.FAKTUROWNIA_USER || !env.FAKTUROWNIA_TOKEN) return json({ error: 'Fakturownia not configured' }, corsHeaders, 500);
        const body = await request.json();
        const response = await fetch(`https://${env.FAKTUROWNIA_USER}.fakturownia.pl/invoices.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_token: env.FAKTUROWNIA_TOKEN, invoice: body }),
        });
        const data = await response.json();
        return json(data, corsHeaders);
      }

      // Get invoice PDF
      if (path.match(/^\/api\/invoices\/\d+\/pdf$/) && method === 'GET') {
        if (!env.FAKTUROWNIA_USER || !env.FAKTUROWNIA_TOKEN) return json({ error: 'Fakturownia not configured' }, corsHeaders, 500);
        const invoiceId = path.replace('/api/invoices/', '').replace('/pdf', '');
        const response = await fetch(`https://${env.FAKTUROWNIA_USER}.fakturownia.pl/invoices/${invoiceId}.pdf?api_token=${env.FAKTUROWNIA_TOKEN}`);
        return new Response(response.body, {
          headers: { 'Content-Type': 'application/pdf', ...corsHeaders },
        });
      }

      // ==================== MODEL USAGE ====================

      // Log model usage (D1 primary, KV fallback)
      if (path === '/usage' && method === 'POST') {
        const body = await request.json();
        const { provider, model, tokens_in, tokens_out, cost, task_type, success } = body;

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

        let id;
        // Try D1 first
        if (env.DB) {
          try {
            const result = await env.DB.prepare(
              'INSERT INTO analytics (provider, model, tokens_in, tokens_out, cost, task_type, success) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).bind(usage.provider, usage.model, usage.tokens_in, usage.tokens_out, usage.cost, usage.task_type, usage.success ? 1 : 0).run();
            id = `d1:${result.meta.last_row_id}`;
          } catch (e) {
            console.error('D1 insert failed:', e);
          }
        }

        // Fallback to KV
        if (!id && env.MEMORY) {
          id = `usage:${Date.now()}`;
          await env.MEMORY.put(id, JSON.stringify(usage), { expirationTtl: 86400 * 90 });
        }

        // Update aggregated stats (still in KV for now)
        if (env.MEMORY) {
          await updateModelStats(env, usage);
        }

        return json({ logged: true, id, storage: id?.startsWith('d1:') ? 'd1' : 'kv' }, corsHeaders);
      }

      // Get usage history (D1 primary, KV fallback)
      if (path === '/usage' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100');

        // Try D1 first
        if (env.DB) {
          try {
            const result = await env.DB.prepare(
              'SELECT id, provider, model, tokens_in, tokens_out, cost, task_type, success, created_at as timestamp FROM analytics ORDER BY id DESC LIMIT ?'
            ).bind(limit).all();
            return json({ usage: result.results, storage: 'd1' }, corsHeaders);
          } catch (e) {
            console.error('D1 query failed:', e);
          }
        }

        // Fallback to KV
        if (!env.MEMORY) return json({ error: 'No storage bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'usage:', limit });
        const usage = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? { id: k.name, ...JSON.parse(val) } : null;
          })
        );
        return json({ usage: usage.filter(Boolean).reverse(), storage: 'kv' }, corsHeaders);
      }

      // Get model stats
      if (path === '/usage/stats' && method === 'GET') {
        const stats = await getModelStats(env);
        return json({ stats }, corsHeaders);
      }

      // Live usage feed (last 10) - D1 primary
      if (path === '/usage/live' && method === 'GET') {
        // Try D1 first
        if (env.DB) {
          try {
            const result = await env.DB.prepare(
              'SELECT id, provider, model, tokens_in, tokens_out, cost, task_type, success, created_at as timestamp FROM analytics ORDER BY id DESC LIMIT 10'
            ).all();
            return json({ usage: result.results, storage: 'd1' }, corsHeaders);
          } catch (e) {
            console.error('D1 query failed:', e);
          }
        }

        // Fallback to KV
        if (!env.MEMORY) return json({ error: 'No storage bound' }, corsHeaders, 500);
        const list = await env.MEMORY.list({ prefix: 'usage:', limit: 10 });
        const usage = await Promise.all(
          list.keys.map(async k => {
            const val = await env.MEMORY.get(k.name);
            return val ? JSON.parse(val) : null;
          })
        );
        return json({ usage: usage.filter(Boolean).reverse(), storage: 'kv' }, corsHeaders);
      }

      // 404
      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
      await log(env, 'error', error.message);
      return json({ error: error.message, stack: error.stack }, corsHeaders, 500);
    }
  },

  // Cron handler - runs every hour
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    await log(env, 'cron', `Scheduled run at ${now}`);
    await incrementStat(env, 'cron_runs');

    // Health check OpenClaw VPS
    try {
      const vpsResponse = await fetch('http://161.97.121.62:18799/health', {
        signal: AbortSignal.timeout(10000)
      });

      if (!vpsResponse.ok) {
        await sendTelegramAlert(env, '🚨 OpenClaw VPS health check failed! Status: ' + vpsResponse.status);
        await log(env, 'health', `VPS DOWN - status ${vpsResponse.status}`);
      } else {
        await log(env, 'health', 'VPS OK');
      }
    } catch (e) {
      await sendTelegramAlert(env, '🚨 OpenClaw VPS unreachable! Error: ' + e.message);
      await log(env, 'health', `VPS UNREACHABLE - ${e.message}`);
    }

    // Cleanup old logs (keep 7 days)
    if (env.DB) {
      try {
        await env.DB.prepare(
          "DELETE FROM logs WHERE created_at < datetime('now', '-7 days')"
        ).run();
      } catch (e) {
        console.error('Cleanup failed:', e);
      }
    }
  }
};

  // Queue consumer handler
  async queue(batch, env) {
    for (const message of batch.messages) {
      const job = message.body;
      console.log(`Processing job: ${job.type}`);

      try {
        switch (job.type) {
          case 'notion-sync':
            // Sync data with Notion
            await log(env, 'queue', `Notion sync started: ${job.entity}`);
            break;

          case 'backup':
            // Backup to R2
            await log(env, 'queue', `Backup started: ${job.target}`);
            break;

          case 'invoice':
            // Generate invoice in Fakturownia
            await log(env, 'queue', `Invoice job: ${job.action}`);
            break;

          case 'alert':
            // Send alert
            await sendTelegramAlert(env, job.message);
            await log(env, 'queue', `Alert sent: ${job.message.substring(0, 50)}`);
            break;

          default:
            await log(env, 'queue', `Unknown job type: ${job.type}`);
        }
        message.ack();
      } catch (e) {
        console.error(`Job failed: ${e.message}`);
        await log(env, 'queue', `Job failed: ${job.type} - ${e.message}`);
        message.retry();
      }
    }
  }
};

// Send Telegram alert
async function sendTelegramAlert(env, message) {
  const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = '6616725127'; // Dawid

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('No Telegram bot token configured');
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Telegram alert failed:', e);
  }
}

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
  const totals = stats.totals || { requests: 0, tokens_in: 0, tokens_out: 0 };
  const taskTypes = stats.task_types || {};
  const models = stats.models || {};
  const modelTaskMatrix = stats.model_task_matrix || {};
  const daily = stats.daily || {};

  // Claude Max usage
  const maxTokensUsed = maxUsage.tokensUsed || 0;
  const maxTokensLimit = maxUsage.tokensLimit || 88000;
  const maxTimeRemaining = maxUsage.timeRemainingHours || '5.0';
  const maxSessions = maxUsage.sessions || 0;
  const maxPercentUsed = Math.min((maxTokensUsed / maxTokensLimit) * 100, 100);
  const maxTokensRemaining = Math.max(maxTokensLimit - maxTokensUsed, 0);
  const maxLastSession = maxUsage.lastSession ? new Date(maxUsage.lastSession).toLocaleTimeString() : '-';

  // Weekly limits
  const weeklyUsed = maxUsage.weeklyTokensUsed || 0;
  const weeklyLimit = maxUsage.weeklyTokensLimit || 400000;
  const weeklyPercent = Math.min((weeklyUsed / weeklyLimit) * 100, 100);
  const weeklyRemaining = Math.max(weeklyLimit - weeklyUsed, 0);
  const daysUntilReset = maxUsage.daysUntilWeekReset || 7;

  // Status colors
  const statusColor = maxPercentUsed >= 100 ? '#ef4444' : maxPercentUsed > 80 ? '#f59e0b' : '#10b981';
  const weeklyColor = weeklyPercent > 80 ? '#ef4444' : weeklyPercent > 50 ? '#f59e0b' : '#10b981';

  // Task type definitions with colors
  const taskDefs = {
    orchestration: { icon: '🎯', color: '#a78bfa', desc: 'Coordination & delegation' },
    planning: { icon: '📋', color: '#818cf8', desc: 'Architecture & design' },
    security: { icon: '🔒', color: '#f43f5e', desc: 'Audits & reviews' },
    coding: { icon: '💻', color: '#f59e0b', desc: 'Implementation' },
    testing: { icon: '🧪', color: '#10b981', desc: 'Tests & validation' },
    refactoring: { icon: '🔧', color: '#06b6d4', desc: 'Code improvement' },
    research: { icon: '🔍', color: '#8b5cf6', desc: 'Investigation' },
    documentation: { icon: '📝', color: '#64748b', desc: 'Docs & comments' },
    general: { icon: '⚡', color: '#888', desc: 'General tasks' }
  };

  // Build task type stats HTML
  const taskTypeEntries = Object.entries(taskTypes).sort((a,b) => b[1].requests - a[1].requests);
  const maxTaskReqs = Math.max(...taskTypeEntries.map(([,v]) => v.requests), 1);
  const taskTypesHTML = taskTypeEntries.length ? taskTypeEntries.map(([type, data]) => {
    const def = taskDefs[type] || taskDefs.general;
    const pct = (data.requests / maxTaskReqs * 100).toFixed(0);
    return `<div class="task-row">
      <div class="task-label"><span>${def.icon}</span> ${type}</div>
      <div class="task-bar-wrap">
        <div class="task-bar" style="width:${pct}%;background:${def.color};"></div>
      </div>
      <div class="task-stats">${data.requests} <span class="dim">(${formatTokens(data.tokens_in + data.tokens_out)})</span></div>
    </div>`;
  }).join('') : '<div class="dim" style="text-align:center;padding:1rem;">No task data yet</div>';

  // Build model stats HTML
  const modelEntries = Object.entries(models).sort((a,b) => b[1].requests - a[1].requests);
  const maxModelReqs = Math.max(...modelEntries.map(([,v]) => v.requests), 1);
  const modelColors = {
    'opus': '#a78bfa', 'sonnet': '#818cf8', 'haiku': '#06b6d4',
    'glm': '#f59e0b', 'gemini': '#10b981', 'gpt': '#ef4444'
  };
  const getModelColor = (name) => {
    const n = name.toLowerCase();
    for (const [k, c] of Object.entries(modelColors)) {
      if (n.includes(k)) return c;
    }
    return '#888';
  };
  const modelsHTML = modelEntries.length ? modelEntries.slice(0, 8).map(([model, data]) => {
    const shortName = model.split('/').pop().replace('claude-', '').slice(0, 20);
    const pct = (data.requests / maxModelReqs * 100).toFixed(0);
    const color = getModelColor(model);
    return `<div class="task-row">
      <div class="task-label" style="color:${color};">${shortName}</div>
      <div class="task-bar-wrap">
        <div class="task-bar" style="width:${pct}%;background:${color};"></div>
      </div>
      <div class="task-stats">${data.requests}</div>
    </div>`;
  }).join('') : '<div class="dim" style="text-align:center;padding:1rem;">No model data yet</div>';

  // Build Model→Task matrix (heatmap)
  const matrixModels = Object.keys(modelTaskMatrix).slice(0, 5);
  const allTasks = [...new Set(Object.values(modelTaskMatrix).flatMap(t => Object.keys(t)))];
  const matrixMax = Math.max(...Object.values(modelTaskMatrix).flatMap(t => Object.values(t)), 1);
  const heatmapHTML = matrixModels.length && allTasks.length ? `
    <table class="heatmap">
      <thead><tr><th></th>${allTasks.map(t => `<th>${(taskDefs[t]?.icon || '⚡')}</th>`).join('')}</tr></thead>
      <tbody>
        ${matrixModels.map(model => {
          const shortName = model.split('/').pop().replace('claude-', '').slice(0, 12);
          return `<tr><td class="model-name">${shortName}</td>${allTasks.map(task => {
            const count = modelTaskMatrix[model]?.[task] || 0;
            const intensity = count / matrixMax;
            const bg = count > 0 ? `rgba(167,139,250,${0.2 + intensity * 0.8})` : 'transparent';
            return `<td style="background:${bg};" title="${model} → ${task}: ${count}">${count || ''}</td>`;
          }).join('')}</tr>`;
        }).join('')}
      </tbody>
    </table>
  ` : '<div class="dim" style="text-align:center;padding:1rem;">No matrix data yet</div>';

  // Daily activity (last 7 days)
  const days = Object.keys(daily).sort().slice(-7);
  const maxDailyReqs = Math.max(...days.map(d => daily[d]?.requests || 0), 1);
  const dailyHTML = days.length ? days.map(day => {
    const d = daily[day];
    const height = (d.requests / maxDailyReqs * 60).toFixed(0);
    const label = day.slice(5); // MM-DD
    return `<div class="daily-bar-wrap">
      <div class="daily-bar" style="height:${height}px;background:linear-gradient(to top, #a78bfa, #818cf8);"></div>
      <div class="daily-label">${label}</div>
    </div>`;
  }).join('') : '<div class="dim">No daily data</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Opus 4.6 Control Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0f; color: #f0f0f5; }
    .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 1.5rem; }
    .header h1 { font-size: 1.3rem; color: #a78bfa; }
    .status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 50% { opacity: 0.5; } }

    .grid { display: grid; gap: 1rem; margin-bottom: 1.5rem; }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
    @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

    .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 0.75rem; padding: 1rem; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .card-title { font-size: 0.8rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }

    .big-num { font-size: 2rem; font-weight: 700; }
    .sub { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }

    .progress { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin: 0.5rem 0; }
    .progress-bar { height: 100%; transition: width 0.3s; }

    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; }

    .tier { padding: 0.75rem; background: #12121a; border-radius: 0.5rem; border-left: 3px solid; }
    .tier-purple { border-color: #a78bfa; }
    .tier-yellow { border-color: #f59e0b; }
    .tier-green { border-color: #10b981; }
    .tier-name { font-weight: 600; font-size: 0.9rem; }
    .tier-desc { font-size: 0.75rem; color: #888; margin-top: 0.25rem; }

    #liveFeed { max-height: 150px; overflow-y: auto; font-size: 0.8rem; }
    .feed-item { padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }

    .btn { padding: 0.5rem 1rem; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: #a78bfa; border-radius: 0.5rem; cursor: pointer; font-size: 0.8rem; }
    .btn:hover { background: rgba(167,139,250,0.1); }

    /* Task types & models */
    .task-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; }
    .task-label { min-width: 100px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; }
    .task-bar-wrap { flex: 1; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .task-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .task-stats { min-width: 80px; text-align: right; font-size: 0.75rem; color: #aaa; }
    .dim { color: #666; }

    /* Heatmap */
    .heatmap { width: 100%; border-collapse: collapse; font-size: 0.7rem; }
    .heatmap th, .heatmap td { padding: 0.3rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); }
    .heatmap th { color: #888; font-weight: normal; }
    .heatmap .model-name { text-align: left; color: #a78bfa; font-weight: 500; max-width: 80px; overflow: hidden; text-overflow: ellipsis; }

    /* Daily chart */
    .daily-chart { display: flex; align-items: flex-end; gap: 0.5rem; height: 80px; padding-top: 1rem; }
    .daily-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; }
    .daily-bar { width: 100%; max-width: 30px; border-radius: 3px 3px 0 0; transition: height 0.3s; }
    .daily-label { font-size: 0.65rem; color: #666; margin-top: 0.3rem; }

    footer { text-align: center; padding: 1rem 0; color: #666; font-size: 0.75rem; border-top: 1px solid rgba(255,255,255,0.05); margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🟣 Opus 4.6 Control Panel</h1>
      <div class="status">
        <span class="dot" style="background:${statusColor}"></span>
        <span>${maxPercentUsed >= 100 ? 'LIMIT REACHED' : maxPercentUsed > 80 ? 'Near Limit' : 'Available'}</span>
      </div>
    </div>

    <!-- MY LIMITS -->
    <div class="grid grid-3">
      <div class="card" style="border-color:${statusColor}40;">
        <div class="card-header">
          <span class="card-title">⏱️ 5h Window</span>
          <span style="color:${statusColor};font-size:0.85rem;font-weight:600;">${maxPercentUsed.toFixed(0)}%</span>
        </div>
        <div class="big-num" style="color:${statusColor};">${formatTokens(maxTokensUsed)}</div>
        <div class="sub">of ${formatTokens(maxTokensLimit)} tokens</div>
        <div class="progress"><div class="progress-bar" style="width:${Math.min(maxPercentUsed,100)}%;background:${statusColor};"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#888;">
          <span>${formatTokens(maxTokensRemaining)} left</span>
          <span>resets in ${maxTimeRemaining}h</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">📅 Weekly</span>
          <span style="color:${weeklyColor};font-size:0.85rem;font-weight:600;">${weeklyPercent.toFixed(0)}%</span>
        </div>
        <div class="big-num" style="color:${weeklyColor};">${formatTokens(weeklyUsed)}</div>
        <div class="sub">of ${formatTokens(weeklyLimit)} tokens</div>
        <div class="progress"><div class="progress-bar" style="width:${Math.min(weeklyPercent,100)}%;background:${weeklyColor};"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#888;">
          <span>${formatTokens(weeklyRemaining)} left</span>
          <span>Mon reset (${daysUntilReset}d)</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">📡 Live Activity</span>
          <span class="dot" style="background:#10b981;width:6px;height:6px;"></span>
        </div>
        <div id="liveFeed"><div style="color:#888;text-align:center;padding:1rem;">Loading...</div></div>
        <button class="btn" onclick="showLog()" style="width:100%;margin-top:0.5rem;">Full Log →</button>
      </div>
    </div>

    <!-- ROUTING RULES -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-title" style="margin-bottom:1rem;">🧠 Task Routing Strategy</div>
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap:0.5rem;">
        <div class="tier tier-purple">
          <div class="tier-name">T0: Opus 4.5 (ME)</div>
          <div class="tier-desc">Orchestration • Security • Architecture • Planning • Decisions</div>
          <div style="font-size:0.65rem;color:#a78bfa;margin-top:0.25rem;">$100/mo Max | I decide, delegate, review</div>
        </div>
        <div class="tier" style="border-color:#ef4444;">
          <div class="tier-name" style="color:#ef4444;">T1: Codex CLI</div>
          <div class="tier-desc">Implementation • Refactoring • Tests • Bulk Coding</div>
          <div style="font-size:0.65rem;color:#ef4444;margin-top:0.25rem;">GPT-5.2-Codex | ChatGPT limits</div>
        </div>
        <div class="tier tier-yellow">
          <div class="tier-name">T2: Sonnet/Haiku</div>
          <div class="tier-desc">Research • Code Review • Exploration • Simple Tasks</div>
          <div style="font-size:0.65rem;color:#f59e0b;margin-top:0.25rem;">Claude subagents | Parallel</div>
        </div>
        <div class="tier tier-green">
          <div class="tier-name">T3: Free/Z.ai</div>
          <div class="tier-desc">Formatting • Translation • Trivial • Fallback</div>
          <div style="font-size:0.65rem;color:#10b981;margin-top:0.25rem;">OpenRouter / Gemini / $3 GLM</div>
        </div>
      </div>
      <div style="margin-top:0.75rem;padding:0.5rem;background:rgba(255,255,255,0.02);border-radius:0.5rem;font-size:0.7rem;color:#888;">
        <strong style="color:#a78bfa;">Flow:</strong> Task → <span style="color:#a78bfa;">Opus analyzes</span> → Routes to optimal tier → <span style="color:#a78bfa;">Opus reviews & synthesizes</span>
      </div>
    </div>

    <!-- ROUTING MATRIX -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">📋 Routing Matrix</div>
      <table class="heatmap" style="font-size:0.75rem;">
        <thead>
          <tr><th style="text-align:left;">Task Type</th><th>Primary</th><th>Fallback</th><th>Parallel?</th></tr>
        </thead>
        <tbody>
          <tr><td style="text-align:left;color:#a78bfa;">🎯 Planning/Architecture</td><td style="color:#a78bfa;">Opus</td><td>-</td><td>No</td></tr>
          <tr><td style="text-align:left;color:#f43f5e;">🔒 Security Audit</td><td style="color:#a78bfa;">Opus</td><td>-</td><td>No</td></tr>
          <tr><td style="text-align:left;color:#ef4444;">💻 Implementation</td><td style="color:#ef4444;">Codex</td><td style="color:#a78bfa;">Opus</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#06b6d4;">🔧 Refactoring</td><td style="color:#ef4444;">Codex</td><td style="color:#a78bfa;">Opus</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#10b981;">🧪 Tests Writing</td><td style="color:#ef4444;">Codex</td><td style="color:#f59e0b;">Sonnet</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#8b5cf6;">📝 Code Review</td><td style="color:#f59e0b;">Haiku x3</td><td>-</td><td>Yes (3 parallel)</td></tr>
          <tr><td style="text-align:left;color:#818cf8;">🔍 Research</td><td style="color:#f59e0b;">Haiku</td><td style="color:#10b981;">Brave</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#888;">⚡ Simple/Trivial</td><td style="color:#10b981;">Free</td><td style="color:#f59e0b;">Haiku</td><td>No</td></tr>
        </tbody>
      </table>
    </div>

    <!-- COSTS & STATS -->
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">💰 Monthly Cost</div>
        <div style="display:flex;gap:1.5rem;">
          <div><div style="font-size:1.5rem;font-weight:700;color:#a78bfa;">$100</div><div class="sub">Claude Max</div></div>
          <div><div style="font-size:1.5rem;font-weight:700;color:#f59e0b;">$3</div><div class="sub">Z.ai GLM</div></div>
          <div><div style="font-size:1.5rem;font-weight:700;color:#10b981;">FREE</div><div class="sub">Gemini/OR</div></div>
        </div>
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.05);font-size:0.85rem;">
          Total: <strong>$103/mo</strong>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">📊 All-Time Stats</div>
        <div style="display:flex;gap:1.5rem;">
          <div><div style="font-size:1.3rem;font-weight:600;">${totals.requests.toLocaleString()}</div><div class="sub">Requests</div></div>
          <div><div style="font-size:1.3rem;font-weight:600;">${formatTokens(totals.tokens_in)}</div><div class="sub">Tokens In</div></div>
          <div><div style="font-size:1.3rem;font-weight:600;">${formatTokens(totals.tokens_out)}</div><div class="sub">Tokens Out</div></div>
        </div>
      </div>
    </div>

    <!-- TASK TYPES & MODELS -->
    <div class="grid grid-2" style="margin-top:1rem;">
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">📊 Task Types</div>
        ${taskTypesHTML}
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">🤖 Models Used</div>
        ${modelsHTML}
      </div>
    </div>

    <!-- MODEL→TASK MATRIX (HEATMAP) -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">🔥 Model → Task Matrix</div>
      ${heatmapHTML}
    </div>

    <!-- DAILY ACTIVITY -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0;">📈 Daily Activity (Last 7 Days)</div>
      <div class="daily-chart">${dailyHTML}</div>
    </div>

    <!-- CLOUDFLARE -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">☁️ Cloudflare (Today)</div>
      <div class="grid grid-3" style="gap:0.5rem;">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
            <span>Requests</span>
            <span style="color:${(cfUsage.requests||0) > 80000 ? '#ef4444' : '#10b981'};">${((cfUsage.requests||0)/1000).toFixed(0)}k/100k</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${Math.min((cfUsage.requests||0)/100000*100,100)}%;background:${(cfUsage.requests||0) > 80000 ? '#ef4444' : '#10b981'};"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
            <span>KV Reads</span>
            <span style="color:${(cfUsage.kv_reads||0) > 80000 ? '#ef4444' : '#10b981'};">${((cfUsage.kv_reads||0)/1000).toFixed(0)}k/100k</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${Math.min((cfUsage.kv_reads||0)/100000*100,100)}%;background:${(cfUsage.kv_reads||0) > 80000 ? '#ef4444' : '#10b981'};"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
            <span>KV Writes</span>
            <span style="color:${(cfUsage.kv_writes||0) > 800 ? '#ef4444' : '#10b981'};">${cfUsage.kv_writes||0}/1k</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${Math.min((cfUsage.kv_writes||0)/1000*100,100)}%;background:${(cfUsage.kv_writes||0) > 800 ? '#ef4444' : '#10b981'};"></div></div>
        </div>
      </div>
    </div>

    <footer>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>Opus 4.5 Dashboard v3.1 | Sessions: ${maxSessions}</span>
        <span id="clock" style="color:#a78bfa;font-weight:500;"></span>
      </div>
    </footer>
  </div>

  <script>
    const colors = {anthropic:'#a78bfa', z_ai:'#f59e0b', openrouter:'#10b981', gemini:'#60a5fa', local:'#888', openai:'#ef4444', codex:'#ef4444'};
    const TZ = 'Europe/Warsaw';

    // Warsaw time clock
    function updateClock() {
      const now = new Date().toLocaleString('pl-PL', {timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit'});
      document.getElementById('clock').textContent = '🕐 ' + now + ' (Warsaw)';
    }
    updateClock(); setInterval(updateClock, 1000);

    // Format time in Warsaw timezone
    function formatWarsawTime(ts) {
      return new Date(ts).toLocaleString('pl-PL', {timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'});
    }

    async function loadFeed() {
      try {
        const r = await fetch('/usage/live');
        const d = await r.json();
        const f = document.getElementById('liveFeed');
        if (d.usage?.length) {
          f.innerHTML = d.usage.slice(0,5).map(u =>
            '<div class="feed-item"><span style="color:'+(colors[u.provider]||'#888')+'">'+(u.model||'?').split('/').pop().slice(0,12)+'</span><span style="color:#666;font-size:0.7rem;">'+formatWarsawTime(u.timestamp)+'</span><span style="color:#888">'+((u.tokens_in||0)+(u.tokens_out||0)).toLocaleString()+'</span></div>'
          ).join('');
        } else f.innerHTML = '<div style="color:#888;text-align:center;">No activity</div>';
      } catch(e) { console.error('Feed error:', e); }
    }
    loadFeed(); setInterval(loadFeed, 15000); // Refresh every 15s

    // Auto-refresh entire dashboard every 60s
    setTimeout(() => location.reload(), 60000);

    function showLog() {
      const m = document.createElement('div');
      m.id = 'modal';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;';
      m.innerHTML = '<div style="background:#12121a;border:1px solid rgba(255,255,255,0.1);border-radius:0.75rem;width:90%;max-width:700px;max-height:70vh;display:flex;flex-direction:column;"><div style="padding:1rem;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;"><span style="font-weight:600;">Usage Log (Warsaw Time)</span><button onclick="document.getElementById(\\'modal\\').remove()" style="background:none;border:none;color:#888;cursor:pointer;font-size:1.2rem;">&times;</button></div><div id="logContent" style="padding:1rem;overflow-y:auto;flex:1;font-size:0.85rem;">Loading...</div></div>';
      document.body.appendChild(m);
      m.onclick = e => { if(e.target===m) m.remove(); };
      fetch('/usage?limit=30').then(r=>r.json()).then(d => {
        document.getElementById('logContent').innerHTML = d.usage?.length
          ? '<table style="width:100%;border-collapse:collapse;"><thead><tr style="color:#888;text-align:left;font-size:0.75rem;"><th style="padding:0.3rem;">Time (Warsaw)</th><th>Model</th><th>Task</th><th>Tokens</th></tr></thead><tbody>'+d.usage.map(u=>'<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:0.3rem;color:#888;">'+formatWarsawTime(u.timestamp)+'</td><td style="color:'+(colors[u.provider]||'#888')+';">'+(u.model||'-')+'</td><td>'+(u.task_type||'-')+'</td><td>'+((u.tokens_in||0)+(u.tokens_out||0)).toLocaleString()+'</td></tr>').join('')+'</tbody></table>'
          : '<div style="color:#888;text-align:center;">No data</div>';
      });
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
