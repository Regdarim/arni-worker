/**
 * Configuration module - centralizes all environment variables with defaults.
 *
 * Values come from wrangler.toml [vars] or Wrangler secrets.
 * Call getConfig(env) to build the config object from the Worker env bindings.
 */

export function getConfig(env) {
  return {
    // Auth
    apiKey: env.API_KEY || 'arni-2026',

    // Version
    version: env.VERSION || '4.0.0',

    // TTLs (seconds)
    webhookTtl: parseInt(env.WEBHOOK_TTL) || 86400 * 30,   // 30 days
    usageTtl: parseInt(env.USAGE_TTL) || 86400 * 90,       // 90 days
    logTtl: parseInt(env.LOG_TTL) || 86400 * 7,             // 7 days
    cfUsageTtl: parseInt(env.CF_USAGE_TTL) || 86400 * 7,    // 7 days

    // Claude Max limits
    maxTokensLimit: parseInt(env.MAX_TOKENS_LIMIT) || 88000,
    weeklyTokensLimit: parseInt(env.WEEKLY_TOKENS_LIMIT) || 400000,
    windowDurationMs: parseInt(env.WINDOW_DURATION_MS) || 5 * 60 * 60 * 1000, // 5h

    // Opus cost per 1K tokens (for savings calculation)
    opusCostIn: parseFloat(env.OPUS_COST_IN) || 0.015,
    opusCostOut: parseFloat(env.OPUS_COST_OUT) || 0.075,

    // List limits
    defaultListLimit: parseInt(env.DEFAULT_LIST_LIMIT) || 100,
    webhookListLimit: parseInt(env.WEBHOOK_LIST_LIMIT) || 50,
  };
}
