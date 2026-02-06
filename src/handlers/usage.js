/**
 * Model usage logging and retrieval endpoints.
 */

import { json } from '../utils.js';
import { getConfig } from '../config.js';
import { updateModelStats, getModelStats } from '../services/model-stats.js';

export async function handleUsageLog(request, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { usageTtl } = getConfig(env);
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

  await env.MEMORY.put(id, JSON.stringify(usage), { expirationTtl: usageTtl });
  await updateModelStats(env, usage);

  return json({ logged: true, id });
}

export async function handleUsageList(url, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { defaultListLimit } = getConfig(env);
  const limit = parseInt(url.searchParams.get('limit') || String(defaultListLimit));
  const list = await env.MEMORY.list({ prefix: 'usage:', limit });
  const usage = await Promise.all(
    list.keys.map(async k => {
      const val = await env.MEMORY.get(k.name);
      return val ? { id: k.name, ...JSON.parse(val) } : null;
    })
  );
  return json({ usage: usage.filter(Boolean).reverse() });
}

export async function handleUsageStats(env) {
  const stats = await getModelStats(env);
  return json({ stats });
}

export async function handleUsageLive(env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const list = await env.MEMORY.list({ prefix: 'usage:', limit: 10 });
  const usage = await Promise.all(
    list.keys.map(async k => {
      const val = await env.MEMORY.get(k.name);
      return val ? JSON.parse(val) : null;
    })
  );
  return json({ usage: usage.filter(Boolean).reverse() });
}
