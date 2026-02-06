/**
 * Model usage statistics aggregation.
 */

import { getConfig } from '../config.js';
import { updateClaudeMaxUsage } from './claude-max.js';

export async function getModelStats(env) {
  if (!env.MEMORY) return getDefaultModelStats();
  const stats = await env.MEMORY.get('model_stats');
  return stats ? JSON.parse(stats) : getDefaultModelStats();
}

export async function updateModelStats(env, usage) {
  if (!env.MEMORY) return;
  const { opusCostIn, opusCostOut } = getConfig(env);
  const stats = await getModelStats(env);

  // Update Claude Max usage if using Anthropic/Opus
  if (usage.provider === 'anthropic' && (usage.model || '').toLowerCase().includes('opus')) {
    await updateClaudeMaxUsage(env, usage.tokens_in || 0, usage.tokens_out || 0);
  }

  // Update provider stats
  if (!stats.providers[usage.provider]) {
    stats.providers[usage.provider] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.providers[usage.provider].requests++;
  stats.providers[usage.provider].tokens_in += usage.tokens_in;
  stats.providers[usage.provider].tokens_out += usage.tokens_out;
  stats.providers[usage.provider].cost += usage.cost;

  // Update model stats
  if (!stats.models[usage.model]) {
    stats.models[usage.model] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.models[usage.model].requests++;
  stats.models[usage.model].tokens_in += usage.tokens_in;
  stats.models[usage.model].tokens_out += usage.tokens_out;
  stats.models[usage.model].cost += usage.cost;

  // Update task type stats
  if (!stats.task_types[usage.task_type]) {
    stats.task_types[usage.task_type] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.task_types[usage.task_type].requests++;
  stats.task_types[usage.task_type].tokens_in += usage.tokens_in;
  stats.task_types[usage.task_type].tokens_out += usage.tokens_out;
  stats.task_types[usage.task_type].cost += usage.cost;

  // Update model->task matrix
  if (!stats.model_task_matrix) stats.model_task_matrix = {};
  if (!stats.model_task_matrix[usage.model]) stats.model_task_matrix[usage.model] = {};
  stats.model_task_matrix[usage.model][usage.task_type] =
    (stats.model_task_matrix[usage.model][usage.task_type] || 0) + 1;

  // Update daily stats
  const today = new Date().toISOString().split('T')[0];
  if (!stats.daily[today]) {
    stats.daily[today] = { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
  }
  stats.daily[today].requests++;
  stats.daily[today].tokens_in += usage.tokens_in;
  stats.daily[today].tokens_out += usage.tokens_out;
  stats.daily[today].cost += usage.cost;

  // Update totals
  stats.totals.requests++;
  stats.totals.tokens_in += usage.tokens_in;
  stats.totals.tokens_out += usage.tokens_out;
  stats.totals.cost += usage.cost;

  // Calculate savings (vs using Opus for everything)
  const opusCost = (usage.tokens_in * opusCostIn + usage.tokens_out * opusCostOut) / 1000;
  stats.totals.savings += Math.max(0, opusCost - usage.cost);

  stats.lastUpdated = new Date().toISOString();
  await env.MEMORY.put('model_stats', JSON.stringify(stats));
}

function getDefaultModelStats() {
  return {
    providers: {
      anthropic: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      openrouter: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      z_ai: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      gemini: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
      local: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0 },
    },
    models: {},
    task_types: {},
    model_task_matrix: {},
    daily: {},
    totals: { requests: 0, tokens_in: 0, tokens_out: 0, cost: 0, savings: 0 },
    lastUpdated: new Date().toISOString(),
  };
}
