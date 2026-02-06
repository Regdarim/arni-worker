/**
 * HTTP proxy endpoint.
 */

import { json } from '../utils.js';
import { log } from '../services/logger.js';

export async function handleProxy(request, env) {
  const body = await request.json();
  const { url: targetUrl, method: targetMethod = 'GET', headers: targetHeaders = {}, data } = body;

  if (!targetUrl) return json({ error: 'URL required' }, 400);

  const proxyResponse = await fetch(targetUrl, {
    method: targetMethod,
    headers: targetHeaders,
    body: data ? JSON.stringify(data) : undefined,
  });

  const responseText = await proxyResponse.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  await log(env, 'proxy', `${targetMethod} ${targetUrl} -> ${proxyResponse.status}`);

  return json({
    status: proxyResponse.status,
    headers: Object.fromEntries(proxyResponse.headers),
    data: responseData,
  });
}
