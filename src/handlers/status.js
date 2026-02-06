/**
 * Status, health, ping, and stats endpoints.
 */

import { json, html } from '../utils.js';
import { getConfig } from '../config.js';
import { getStats } from '../services/logger.js';
import { statusPage } from '../pages/status.js';

export async function handleStatusPage() {
  return html(statusPage());
}

export async function handleHealth(env) {
  const { version } = getConfig(env);
  const stats = await getStats(env);
  return json({
    status: 'ok',
    agent: 'arni',
    timestamp: new Date().toISOString(),
    version,
    kv: env.MEMORY ? 'connected' : 'not bound',
    stats,
  });
}

export function handlePing() {
  return json({ pong: true, time: Date.now() });
}

export async function handleStats(env) {
  const stats = await getStats(env);
  return json({ stats });
}
