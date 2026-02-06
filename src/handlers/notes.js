/**
 * Notes management endpoints.
 */

import { json } from '../utils.js';
import { getConfig } from '../config.js';
import { log } from '../services/logger.js';

export async function handleNoteList(env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { defaultListLimit } = getConfig(env);
  const list = await env.MEMORY.list({ prefix: 'note:', limit: defaultListLimit });
  const notes = await Promise.all(
    list.keys.map(async k => {
      const val = await env.MEMORY.get(k.name);
      return val ? { id: k.name, ...JSON.parse(val) } : null;
    })
  );
  return json({ notes: notes.filter(Boolean) });
}

export async function handleNoteCreate(request, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
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
  return json({ created: true, id, note });
}

export async function handleNoteUpdate(request, path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const id = 'note:' + path.replace('/notes/', '');
  const existing = await env.MEMORY.get(id);
  if (!existing) return json({ error: 'Note not found' }, 404);
  const note = JSON.parse(existing);
  const updates = await request.json();
  const updated = { ...note, ...updates, updated: new Date().toISOString() };
  await env.MEMORY.put(id, JSON.stringify(updated));
  return json({ updated: true, id, note: updated });
}

export async function handleNoteDelete(path, env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const id = 'note:' + path.replace('/notes/', '');
  await env.MEMORY.delete(id);
  return json({ deleted: true, id });
}
