/**
 * Dashboard HTML page - Model Usage Analytics.
 */

import { formatTokens } from '../utils.js';

export function dashboardPage(stats, cfUsage = {}, maxUsage = {}) {
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
    general: { icon: '⚡', color: '#888', desc: 'General tasks' },
  };

  const taskTypesHTML = buildTaskTypesHTML(taskTypes, taskDefs);
  const modelsHTML = buildModelsHTML(models);
  const heatmapHTML = buildHeatmapHTML(modelTaskMatrix, taskDefs);
  const dailyHTML = buildDailyHTML(daily);

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

    .task-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; }
    .task-label { min-width: 100px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; }
    .task-bar-wrap { flex: 1; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .task-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .task-stats { min-width: 80px; text-align: right; font-size: 0.75rem; color: #aaa; }
    .dim { color: #666; }

    .heatmap { width: 100%; border-collapse: collapse; font-size: 0.7rem; }
    .heatmap th, .heatmap td { padding: 0.3rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); }
    .heatmap th { color: #888; font-weight: normal; }
    .heatmap .model-name { text-align: left; color: #a78bfa; font-weight: 500; max-width: 80px; overflow: hidden; text-overflow: ellipsis; }

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
      <h1>Opus 4.6 Control Panel</h1>
      <div class="status">
        <span class="dot" style="background:${statusColor}"></span>
        <span>${maxPercentUsed >= 100 ? 'LIMIT REACHED' : maxPercentUsed > 80 ? 'Near Limit' : 'Available'}</span>
      </div>
    </div>

    <!-- MY LIMITS -->
    <div class="grid grid-3">
      <div class="card" style="border-color:${statusColor}40;">
        <div class="card-header">
          <span class="card-title">5h Window</span>
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
          <span class="card-title">Weekly</span>
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
          <span class="card-title">Live Activity</span>
          <span class="dot" style="background:#10b981;width:6px;height:6px;"></span>
        </div>
        <div id="liveFeed"><div style="color:#888;text-align:center;padding:1rem;">Loading...</div></div>
        <button class="btn" onclick="showLog()" style="width:100%;margin-top:0.5rem;">Full Log</button>
      </div>
    </div>

    <!-- ROUTING RULES -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-title" style="margin-bottom:1rem;">Task Routing Strategy</div>
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap:0.5rem;">
        <div class="tier tier-purple">
          <div class="tier-name">T0: Opus 4.5 (ME)</div>
          <div class="tier-desc">Orchestration - Security - Architecture - Planning - Decisions</div>
          <div style="font-size:0.65rem;color:#a78bfa;margin-top:0.25rem;">$100/mo Max | I decide, delegate, review</div>
        </div>
        <div class="tier" style="border-color:#ef4444;">
          <div class="tier-name" style="color:#ef4444;">T1: Codex CLI</div>
          <div class="tier-desc">Implementation - Refactoring - Tests - Bulk Coding</div>
          <div style="font-size:0.65rem;color:#ef4444;margin-top:0.25rem;">GPT-5.2-Codex | ChatGPT limits</div>
        </div>
        <div class="tier tier-yellow">
          <div class="tier-name">T2: Sonnet/Haiku</div>
          <div class="tier-desc">Research - Code Review - Exploration - Simple Tasks</div>
          <div style="font-size:0.65rem;color:#f59e0b;margin-top:0.25rem;">Claude subagents | Parallel</div>
        </div>
        <div class="tier tier-green">
          <div class="tier-name">T3: Free/Z.ai</div>
          <div class="tier-desc">Formatting - Translation - Trivial - Fallback</div>
          <div style="font-size:0.65rem;color:#10b981;margin-top:0.25rem;">OpenRouter / Gemini / $3 GLM</div>
        </div>
      </div>
      <div style="margin-top:0.75rem;padding:0.5rem;background:rgba(255,255,255,0.02);border-radius:0.5rem;font-size:0.7rem;color:#888;">
        <strong style="color:#a78bfa;">Flow:</strong> Task &rarr; <span style="color:#a78bfa;">Opus analyzes</span> &rarr; Routes to optimal tier &rarr; <span style="color:#a78bfa;">Opus reviews &amp; synthesizes</span>
      </div>
    </div>

    <!-- ROUTING MATRIX -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">Routing Matrix</div>
      <table class="heatmap" style="font-size:0.75rem;">
        <thead>
          <tr><th style="text-align:left;">Task Type</th><th>Primary</th><th>Fallback</th><th>Parallel?</th></tr>
        </thead>
        <tbody>
          <tr><td style="text-align:left;color:#a78bfa;">Planning/Architecture</td><td style="color:#a78bfa;">Opus</td><td>-</td><td>No</td></tr>
          <tr><td style="text-align:left;color:#f43f5e;">Security Audit</td><td style="color:#a78bfa;">Opus</td><td>-</td><td>No</td></tr>
          <tr><td style="text-align:left;color:#ef4444;">Implementation</td><td style="color:#ef4444;">Codex</td><td style="color:#a78bfa;">Opus</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#06b6d4;">Refactoring</td><td style="color:#ef4444;">Codex</td><td style="color:#a78bfa;">Opus</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#10b981;">Tests Writing</td><td style="color:#ef4444;">Codex</td><td style="color:#f59e0b;">Sonnet</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#8b5cf6;">Code Review</td><td style="color:#f59e0b;">Haiku x3</td><td>-</td><td>Yes (3 parallel)</td></tr>
          <tr><td style="text-align:left;color:#818cf8;">Research</td><td style="color:#f59e0b;">Haiku</td><td style="color:#10b981;">Brave</td><td>Yes</td></tr>
          <tr><td style="text-align:left;color:#888;">Simple/Trivial</td><td style="color:#10b981;">Free</td><td style="color:#f59e0b;">Haiku</td><td>No</td></tr>
        </tbody>
      </table>
    </div>

    <!-- COSTS & STATS -->
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">Monthly Cost</div>
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
        <div class="card-title" style="margin-bottom:0.75rem;">All-Time Stats</div>
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
        <div class="card-title" style="margin-bottom:0.75rem;">Task Types</div>
        ${taskTypesHTML}
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;">Models Used</div>
        ${modelsHTML}
      </div>
    </div>

    <!-- MODEL->TASK MATRIX (HEATMAP) -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">Model / Task Matrix</div>
      ${heatmapHTML}
    </div>

    <!-- DAILY ACTIVITY -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0;">Daily Activity (Last 7 Days)</div>
      <div class="daily-chart">${dailyHTML}</div>
    </div>

    <!-- CLOUDFLARE -->
    <div class="card" style="margin-top:1rem;">
      <div class="card-title" style="margin-bottom:0.75rem;">Cloudflare (Today)</div>
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
        <span>Opus 4.6 Dashboard v4.0 | Sessions: ${maxSessions}</span>
        <span id="clock" style="color:#a78bfa;font-weight:500;"></span>
      </div>
    </footer>
  </div>

  <script>
    const colors = {anthropic:'#a78bfa', z_ai:'#f59e0b', openrouter:'#10b981', gemini:'#60a5fa', local:'#888', openai:'#ef4444', codex:'#ef4444'};
    const TZ = 'Europe/Warsaw';

    function updateClock() {
      const now = new Date().toLocaleString('pl-PL', {timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit'});
      document.getElementById('clock').textContent = now + ' (Warsaw)';
    }
    updateClock(); setInterval(updateClock, 1000);

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
    loadFeed(); setInterval(loadFeed, 15000);

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

// --- Helper functions for dashboard HTML generation ---

function buildTaskTypesHTML(taskTypes, taskDefs) {
  const entries = Object.entries(taskTypes).sort((a,b) => b[1].requests - a[1].requests);
  const maxReqs = Math.max(...entries.map(([,v]) => v.requests), 1);
  if (!entries.length) return '<div class="dim" style="text-align:center;padding:1rem;">No task data yet</div>';

  return entries.map(([type, data]) => {
    const def = taskDefs[type] || taskDefs.general;
    const pct = (data.requests / maxReqs * 100).toFixed(0);
    return `<div class="task-row">
      <div class="task-label"><span>${def.icon}</span> ${type}</div>
      <div class="task-bar-wrap">
        <div class="task-bar" style="width:${pct}%;background:${def.color};"></div>
      </div>
      <div class="task-stats">${data.requests} <span class="dim">(${formatTokens(data.tokens_in + data.tokens_out)})</span></div>
    </div>`;
  }).join('');
}

function buildModelsHTML(models) {
  const modelColors = {
    'opus': '#a78bfa', 'sonnet': '#818cf8', 'haiku': '#06b6d4',
    'glm': '#f59e0b', 'gemini': '#10b981', 'gpt': '#ef4444',
  };
  const getColor = (name) => {
    const n = name.toLowerCase();
    for (const [k, c] of Object.entries(modelColors)) {
      if (n.includes(k)) return c;
    }
    return '#888';
  };

  const entries = Object.entries(models).sort((a,b) => b[1].requests - a[1].requests);
  const maxReqs = Math.max(...entries.map(([,v]) => v.requests), 1);
  if (!entries.length) return '<div class="dim" style="text-align:center;padding:1rem;">No model data yet</div>';

  return entries.slice(0, 8).map(([model, data]) => {
    const shortName = model.split('/').pop().replace('claude-', '').slice(0, 20);
    const pct = (data.requests / maxReqs * 100).toFixed(0);
    const color = getColor(model);
    return `<div class="task-row">
      <div class="task-label" style="color:${color};">${shortName}</div>
      <div class="task-bar-wrap">
        <div class="task-bar" style="width:${pct}%;background:${color};"></div>
      </div>
      <div class="task-stats">${data.requests}</div>
    </div>`;
  }).join('');
}

function buildHeatmapHTML(modelTaskMatrix, taskDefs) {
  const matrixModels = Object.keys(modelTaskMatrix).slice(0, 5);
  const allTasks = [...new Set(Object.values(modelTaskMatrix).flatMap(t => Object.keys(t)))];
  const matrixMax = Math.max(...Object.values(modelTaskMatrix).flatMap(t => Object.values(t)), 1);

  if (!matrixModels.length || !allTasks.length) {
    return '<div class="dim" style="text-align:center;padding:1rem;">No matrix data yet</div>';
  }

  return `
    <table class="heatmap">
      <thead><tr><th></th>${allTasks.map(t => `<th>${(taskDefs[t]?.icon || '')}</th>`).join('')}</tr></thead>
      <tbody>
        ${matrixModels.map(model => {
          const shortName = model.split('/').pop().replace('claude-', '').slice(0, 12);
          return `<tr><td class="model-name">${shortName}</td>${allTasks.map(task => {
            const count = modelTaskMatrix[model]?.[task] || 0;
            const intensity = count / matrixMax;
            const bg = count > 0 ? `rgba(167,139,250,${0.2 + intensity * 0.8})` : 'transparent';
            return `<td style="background:${bg};" title="${model} / ${task}: ${count}">${count || ''}</td>`;
          }).join('')}</tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function buildDailyHTML(daily) {
  const days = Object.keys(daily).sort().slice(-7);
  const maxReqs = Math.max(...days.map(d => daily[d]?.requests || 0), 1);
  if (!days.length) return '<div class="dim">No daily data</div>';

  return days.map(day => {
    const d = daily[day];
    const height = (d.requests / maxReqs * 60).toFixed(0);
    const label = day.slice(5); // MM-DD
    return `<div class="daily-bar-wrap">
      <div class="daily-bar" style="height:${height}px;background:linear-gradient(to top, #a78bfa, #818cf8);"></div>
      <div class="daily-label">${label}</div>
    </div>`;
  }).join('');
}
