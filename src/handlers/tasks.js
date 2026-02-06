/**
 * Task management endpoints.
 */

import { json } from '../utils.js';
import { getConfig } from '../config.js';
import { log } from '../services/logger.js';

export async function handleTaskList(env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { defaultListLimit } = getConfig(env);
  const list = await env.MEMORY.list({ prefix: 'task:', limit: defaultListLimit });
  const tasks = await Promise.all(
    list.keys.map(async k => {
      const val = await env.MEMORY.get(k.name);
      return val ? { id: k.name, ...JSON.parse(val) } : null;
    })
  );
  return json({ tasks: tasks.filter(Boolean) });
}

export async function handleTaskCreate(request, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
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
  return json({ created: true, id, task });
}

export async function handleTaskUpdate(request, path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const id = 'task:' + path.replace('/tasks/', '');
  const existing = await env.MEMORY.get(id);
  if (!existing) return json({ error: 'Task not found' }, 404);
  const task = JSON.parse(existing);
  const updates = await request.json();
  const updated = { ...task, ...updates, updated: new Date().toISOString() };
  await env.MEMORY.put(id, JSON.stringify(updated));
  await log(env, 'task', `Updated: ${updated.title} -> ${updates.status || 'modified'}`);
  return json({ updated: true, id, task: updated });
}

export async function handleTaskDelete(path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const id = 'task:' + path.replace('/tasks/', '');
  await env.MEMORY.delete(id);
  await log(env, 'task', `Deleted: ${id}`);
  return json({ deleted: true, id });
}
