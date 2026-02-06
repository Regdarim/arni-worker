/**
 * Status / landing page HTML.
 */

export function statusPage() {
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
      <h2>Dashboard</h2>
      <p style="margin-bottom: 1rem; color: #ccc;">Visual analytics for model usage, costs, and savings</p>
      <a href="/dashboard" style="display: inline-block; background: #00ff88; color: #000; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold;">Open Dashboard</a>
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

    <p class="footer">v4.0.0 | Cloudflare Workers + KV | <a href="/dashboard" style="color:#00ff88">Dashboard</a></p>
  </div>
</body>
</html>`;
}
