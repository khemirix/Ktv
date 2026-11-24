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

function nonNegativeInt(env, name, fallback, min, max) {
  var raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  var value = Number(raw);
  if (!isFinite(value) || value < 0) return fallback;
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
    version: env.VERSION || '1.4.0',
    publicBaseUrl: String(env.SMART_PROXY_PUBLIC_BASE_URL || '').trim(),
    maxUrlLength: positiveInt(env, 'MAX_URL_LENGTH', 4096, 128, 65536),

    // DNS is retried because IPTV hosts often fail a single lookup once.
    dnsTimeoutMs: positiveInt(env, 'DNS_TIMEOUT_MS', 4000, 200, 30000),
    dnsRetries: nonNegativeInt(env, 'DNS_RETRIES', 2, 0, 10),
    dnsRetryDelayMs: nonNegativeInt(env, 'DNS_RETRY_DELAY_MS', 250, 0, 5000),

    // Separate network phases so a slow provider is not misclassified.
    connectTimeoutMs: positiveInt(env, 'CONNECT_TIMEOUT_MS', 10000, 500, 60000),
    tlsTimeoutMs: positiveInt(env, 'TLS_TIMEOUT_MS', 10000, 500, 60000),
    headersTimeoutMs: positiveInt(env, 'HEADERS_TIMEOUT_MS', 20000, 500, 180000),
    idleTimeoutMs: positiveInt(env, 'IDLE_TIMEOUT_MS', 60000, 1000, 600000),

    // Address failover is bounded and reuses only DNS records already validated.
    maxAddressAttempts: positiveInt(env, 'MAX_ADDRESS_ATTEMPTS', 4, 1, 16),
    connectionDeadlineMs: positiveInt(env, 'CONNECTION_DEADLINE_MS', 30000, 1000, 300000),

    // A deliberately small, safe set of upstream request overrides.
    upstreamUserAgent: String(env.UPSTREAM_USER_AGENT || '').trim(),
    upstreamUserAgentProfile: String(env.UPSTREAM_USER_AGENT_PROFILE || 'default').toLowerCase(),
    upstreamAccept: String(env.UPSTREAM_ACCEPT || '*/*').trim() || '*/*',
    upstreamAcceptLanguage: String(env.UPSTREAM_ACCEPT_LANGUAGE || '').trim(),
    upstreamReferer: String(env.UPSTREAM_REFERER || '').trim(),

    // Temporary TCP diagnostics. Both must be set; the endpoint is hidden by default.
    allowTcpDiagnostics: String(env.ALLOW_TCP_DIAGNOSTICS || '').toLowerCase() === 'true',
    diagnosticsToken: String(env.DIAGNOSTICS_TOKEN || ''),

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
