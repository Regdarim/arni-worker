/**
 * Configuration read/write endpoints.
 */

import { json } from '../utils.js';
import { log } from '../services/logger.js';

export async function handleConfigGet(env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const config = await env.MEMORY.get('config:main');
  return json({ config: config ? JSON.parse(config) : {} });
}

export async function handleConfigPut(request, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const body = await request.text();
  await env.MEMORY.put('config:main', body);
  await log(env, 'config', 'Configuration updated');
  return json({ updated: true });
}
