/**
 * Cloudflare usage tracking (requests, KV reads/writes per day).
 */

import { getConfig } from '../config.js';

export async function trackCloudflareUsage(env, path) {
  if (!env.MEMORY) return;
  const { cfUsageTtl } = getConfig(env);
  const today = new Date().toISOString().split('T')[0];
  const key = `cf_usage:${today}`;

  try {
    const existing = await env.MEMORY.get(key);
    const usage = existing ? JSON.parse(existing) : {
      requests: 0,
      kv_reads: 0,
      kv_writes: 0,
      date: today,
    };

    usage.requests++;
    if (path.includes('/memory') || path.includes('/usage') || path.includes('/tasks') || path.includes('/notes') || path.includes('/logs')) {
      usage.kv_reads++;
    }
    if (path.includes('/webhook') || path.includes('/usage') || path.includes('/tasks') || path.includes('/notes')) {
      usage.kv_writes++;
    }

    await env.MEMORY.put(key, JSON.stringify(usage), { expirationTtl: cfUsageTtl });
  } catch (e) {
    // Silent fail - don't break main request
  }
}

export async function getCloudflareUsage(env) {
  if (!env.MEMORY) return getDefaultCfUsage();
  const today = new Date().toISOString().split('T')[0];
  const key = `cf_usage:${today}`;

  try {
    const usage = await env.MEMORY.get(key);
    return usage ? JSON.parse(usage) : getDefaultCfUsage();
  } catch (e) {
    return getDefaultCfUsage();
  }
}

function getDefaultCfUsage() {
  return {
    requests: 0,
    kv_reads: 0,
    kv_writes: 0,
    date: new Date().toISOString().split('T')[0],
  };
}
