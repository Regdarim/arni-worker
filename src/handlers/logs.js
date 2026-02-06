/**
 * Activity logs endpoint.
 */

import { json } from '../utils.js';

export async function handleLogList(url, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
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
  return json({ logs: logs.filter(Boolean).reverse() });
}
