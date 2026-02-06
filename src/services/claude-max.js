/**
 * Claude Max usage tracking (5-hour rolling window + weekly limit).
 */

import { getConfig } from '../config.js';
import { getWeekStart } from '../utils.js';

export async function getClaudeMaxUsage(env) {
  if (!env.MEMORY) return getDefaultMaxUsage(env);
  const key = 'claude_max_usage';
  const { maxTokensLimit, weeklyTokensLimit, windowDurationMs } = getConfig(env);

  try {
    const data = await env.MEMORY.get(key);
    if (!data) return getDefaultMaxUsage(env);

    const usage = JSON.parse(data);
    const now = Date.now();
    const windowStart = usage.windowStart || now;
    const currentWeekStart = getWeekStart();

    // Check if 5h window has expired
    if (now - windowStart > windowDurationMs) {
      usage.tokensUsed = 0;
      usage.windowStart = now;
      usage.sessions = 0;
    }

    // Check if week changed
    if (!usage.weekStart || usage.weekStart < currentWeekStart) {
      usage.weeklyTokensUsed = 0;
      usage.weekStart = currentWeekStart;
    }

    // Calculate time remaining in 5h window
    const timeRemaining = windowDurationMs - (now - (usage.windowStart || now));
    usage.timeRemainingMs = Math.max(0, timeRemaining);
    usage.timeRemainingHours = (Math.max(0, timeRemaining) / (1000 * 60 * 60)).toFixed(1);

    // Calculate days until Monday reset
    const msUntilMonday = (currentWeekStart + 7 * 24 * 60 * 60 * 1000) - now;
    usage.daysUntilWeekReset = Math.ceil(msUntilMonday / (24 * 60 * 60 * 1000));

    // Ensure weekly fields exist
    usage.weeklyTokensUsed = usage.weeklyTokensUsed || 0;
    usage.weeklyTokensLimit = usage.weeklyTokensLimit || weeklyTokensLimit;
    usage.tokensLimit = usage.tokensLimit || maxTokensLimit;

    return usage;
  } catch (e) {
    return getDefaultMaxUsage(env);
  }
}

export async function updateClaudeMaxUsage(env, tokensIn, tokensOut) {
  if (!env.MEMORY) return;
  const { maxTokensLimit, weeklyTokensLimit, windowDurationMs } = getConfig(env);
  const key = 'claude_max_usage';
  const totalTokens = tokensIn + tokensOut;

  const raw = await env.MEMORY.get(key);
  let usage;

  if (raw) {
    usage = JSON.parse(raw);
    const now = Date.now();
    const currentWeekStart = getWeekStart();

    if (now - usage.windowStart > windowDurationMs) {
      usage.tokensUsed = 0;
      usage.windowStart = now;
      usage.sessions = 0;
    }

    if (!usage.weekStart || usage.weekStart < currentWeekStart) {
      usage.weeklyTokensUsed = 0;
      usage.weekStart = currentWeekStart;
    }
  } else {
    usage = getDefaultMaxUsage(env);
  }

  usage.tokensUsed += totalTokens;
  usage.weeklyTokensUsed = (usage.weeklyTokensUsed || 0) + totalTokens;
  usage.sessions++;
  usage.lastSession = new Date().toISOString();

  const toStore = {
    tokensUsed: usage.tokensUsed,
    tokensLimit: usage.tokensLimit || maxTokensLimit,
    windowStart: usage.windowStart,
    sessions: usage.sessions,
    lastSession: usage.lastSession,
    weeklyTokensUsed: usage.weeklyTokensUsed,
    weeklyTokensLimit: usage.weeklyTokensLimit || weeklyTokensLimit,
    weekStart: usage.weekStart || getWeekStart(),
  };

  await env.MEMORY.put(key, JSON.stringify(toStore));
}

function getDefaultMaxUsage(env) {
  const { maxTokensLimit, weeklyTokensLimit, windowDurationMs } = getConfig(env);
  return {
    tokensUsed: 0,
    tokensLimit: maxTokensLimit,
    windowStart: Date.now(),
    timeRemainingMs: windowDurationMs,
    timeRemainingHours: (windowDurationMs / (1000 * 60 * 60)).toFixed(1),
    sessions: 0,
    lastSession: null,
    weeklyTokensUsed: 0,
    weeklyTokensLimit: weeklyTokensLimit,
    weekStart: getWeekStart(),
  };
}
