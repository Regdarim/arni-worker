/**
 * Arni Webhook & Status Worker
 *
 * Endpoints:
 * - GET /          - Status page
 * - GET /health    - Health check (JSON)
 * - POST /webhook  - Receive webhooks
 * - GET /api/ping  - Simple ping
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Routes
    try {
      // Status page
      if (path === '/' && method === 'GET') {
        return new Response(statusPage(), {
          headers: { 'Content-Type': 'text/html', ...corsHeaders },
        });
      }

      // Health check
      if (path === '/health' && method === 'GET') {
        return Response.json({
          status: 'ok',
          agent: 'arni',
          timestamp: new Date().toISOString(),
          uptime: 'always-on',
        }, { headers: corsHeaders });
      }

      // Ping
      if (path === '/api/ping' && method === 'GET') {
        return Response.json({ pong: true, time: Date.now() }, { headers: corsHeaders });
      }

      // Webhook receiver
      if (path === '/webhook' && method === 'POST') {
        const body = await request.text();
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          data = { raw: body };
        }

        // Log webhook (in production, could store in KV or forward)
        console.log('Webhook received:', {
          timestamp: new Date().toISOString(),
          headers: Object.fromEntries(request.headers),
          data,
        });

        return Response.json({
          received: true,
          timestamp: new Date().toISOString(),
        }, { headers: corsHeaders });
      }

      // 404
      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
      return Response.json({
        error: error.message,
      }, { status: 500, headers: corsHeaders });
    }
  },
};

function statusPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arni - Status</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 3rem;
      margin-bottom: 0.5rem;
      color: #00ff88;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #1a1a1a;
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      margin: 1rem 0;
    }
    .dot {
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .info {
      color: #888;
      margin-top: 2rem;
      font-size: 0.9rem;
    }
    .endpoints {
      text-align: left;
      background: #1a1a1a;
      padding: 1rem;
      border-radius: 0.5rem;
      margin-top: 1rem;
      font-family: monospace;
      font-size: 0.85rem;
    }
    .endpoints code {
      color: #00ff88;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Arni</h1>
    <p>Autonomous Agent</p>
    <div class="status">
      <span class="dot"></span>
      <span>Online</span>
    </div>
    <div class="endpoints">
      <div><code>GET /health</code> - Health check</div>
      <div><code>GET /api/ping</code> - Ping</div>
      <div><code>POST /webhook</code> - Receive webhooks</div>
    </div>
    <p class="info">Running on Cloudflare Workers</p>
  </div>
</body>
</html>`;
}
