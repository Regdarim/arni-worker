/**
 * KV Memory CRUD endpoints.
 */

import { json } from '../utils.js';
import { getConfig } from '../config.js';

export async function handleMemoryList(url, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { defaultListLimit } = getConfig(env);
  const prefix = url.searchParams.get('prefix') || '';
  const list = await env.MEMORY.list({ prefix, limit: defaultListLimit });
  return json({ keys: list.keys.map(k => k.name) });
}

export async function handleMemoryGet(path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const key = decodeURIComponent(path.replace('/memory/', ''));
  const value = await env.MEMORY.get(key);
  if (value === null) return json({ error: 'Key not found' }, 404);
  try {
    return json({ key, value: JSON.parse(value) });
  } catch {
    return json({ key, value });
  }
}

export async function handleMemoryPut(request, url, path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const key = decodeURIComponent(path.replace('/memory/', ''));
  const body = await request.text();
  const ttl = url.searchParams.get('ttl');
  const options = ttl ? { expirationTtl: parseInt(ttl) } : {};
  await env.MEMORY.put(key, body, options);
  return json({ stored: true, key });
}

export async function handleMemoryDelete(path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const key = decodeURIComponent(path.replace('/memory/', ''));
  await env.MEMORY.delete(key);
  return json({ deleted: true, key });
}
