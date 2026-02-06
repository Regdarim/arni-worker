/**
 * Webhook receive and list endpoints.
 */

import { json } from '../utils.js';
import { getConfig } from '../config.js';
import { log, incrementStat } from '../services/logger.js';

export async function handleWebhookReceive(request, env) {
  const { webhookTtl } = getConfig(env);
  const body = await request.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    data = { raw: body };
  }

  const source = request.headers.get('X-Webhook-Source') || 'unknown';
  const webhookId = `webhook:${Date.now()}:${source}`;

  if (env.MEMORY) {
    await env.MEMORY.put(webhookId, JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      headers: Object.fromEntries(request.headers),
      data,
    }), { expirationTtl: webhookTtl });

    await incrementStat(env, 'webhooks_received');
  }

  await log(env, 'webhook', `Received from ${source}`);

  return json({
    received: true,
    id: webhookId,
    timestamp: new Date().toISOString(),
  });
}

export async function handleWebhookList(env) {
  if (!env.MEMORY) return json({ error: 'KV not bound' }, 500);
  const { webhookListLimit } = getConfig(env);
  const list = await env.MEMORY.list({ prefix: 'webhook:', limit: webhookListLimit });
  return json({
    webhooks: list.keys.map(k => ({
      id: k.name,
      expiration: k.expiration,
    })),
  });
}
