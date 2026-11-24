'use strict';

function positiveInt(env, name, fallback, min, max) {
  var raw = env[name];
  var value = Number(raw);
  if (!isFinite(value) || value <= 0) return fallback;
  value = Math.floor(value);
  if (typeof min === 'number' && value < min) return min;
  if (typeof max === 'number' && value > max) return max;
  return value;
}

function loadConfig(env) {
  env = env || {};
  return {
    port: positiveInt(env, 'PORT', 10000, 1, 65535),
    host: env.HOST || '0.0.0.0',
    version: env.VERSION || '1.0.0',
    publicBaseUrl: String(env.SMART_PROXY_PUBLIC_BASE_URL || '').trim(),
    maxUrlLength: positiveInt(env, 'MAX_URL_LENGTH', 4096, 128, 65536),
    connectTimeoutMs: positiveInt(env, 'CONNECT_TIMEOUT_MS', 8000, 500, 60000),
    headersTimeoutMs: positiveInt(env, 'HEADERS_TIMEOUT_MS', 12000, 500, 120000),
    idleTimeoutMs: positiveInt(env, 'IDLE_TIMEOUT_MS', 30000, 1000, 600000),
    detectMaxBytes: positiveInt(env, 'DETECT_MAX_BYTES', 65536, 512, 1048576),
    maxPlaylistBytes: positiveInt(env, 'MAX_PLAYLIST_BYTES', 1048576, 4096, 16777216),
    peekBytes: positiveInt(env, 'PEEK_BYTES', 16384, 512, 262144),
    maxRedirects: positiveInt(env, 'MAX_REDIRECTS', 5, 0, 20),
    maxConcurrentStreams: positiveInt(env, 'MAX_CONCURRENT_STREAMS', 100, 1, 10000),
    rateLimitWindowMs: positiveInt(env, 'RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
    rateLimitMax: positiveInt(env, 'RATE_LIMIT_MAX', 120, 1, 100000),
    processingEngine: String(env.PROCESSING_ENGINE || 'direct').toLowerCase(),
    logLevel: String(env.LOG_LEVEL || 'info').toLowerCase()
  };
}

module.exports = {
  loadConfig: loadConfig,
  config: loadConfig(process.env)
};
