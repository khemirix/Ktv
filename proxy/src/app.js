'use strict';

const http = require('node:http');
const { config: defaultConfig } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { sendError, sendRouteError } = require('./middleware/response');
const { createRateLimiter } = require('./security/rate-limit');
const { createConnectionLimit } = require('./security/connection-limit');
const { selectEngine } = require('./stream/engines');
const { publicBaseFromRequest } = require('./utils/request');
const { healthHandler } = require('./routes/health');
const { detectHandler } = require('./routes/detect');
const { streamInfoHandler } = require('./routes/stream-info');
const { streamHandler } = require('./routes/stream');

function createApp(overrides) {
  overrides = overrides || {};
  var cfg = Object.assign({}, defaultConfig, overrides.config || {});
  var rateLimit = createRateLimiter({
    windowMs: cfg.rateLimitWindowMs,
    max: cfg.rateLimitMax
  });
  var connectionLimit = createConnectionLimit(cfg.maxConcurrentStreams);
  var engine = selectEngine(cfg.processingEngine);

  var requestOptions = Object.assign({
    allowPrivate: !!overrides.allowPrivate,
    allowPrivateRedirects: !!overrides.allowPrivateRedirects,
    maxUrlLength: cfg.maxUrlLength,
    dnsTimeoutMs: cfg.dnsTimeoutMs,
    dnsRetries: cfg.dnsRetries,
    dnsRetryDelayMs: cfg.dnsRetryDelayMs,
    connectTimeoutMs: cfg.connectTimeoutMs,
    tlsTimeoutMs: cfg.tlsTimeoutMs,
    headersTimeoutMs: cfg.headersTimeoutMs,
    idleTimeoutMs: cfg.idleTimeoutMs,
    maxRedirects: cfg.maxRedirects
  }, overrides.requestOptions || {});

  var server = http.createServer(async function (req, res) {
    if (corsMiddleware(req, res)) return;

    var parsed;
    try {
      parsed = new URL(req.url || '/', 'http://localhost');
    } catch (e) {
      sendError(res, 400, 'INVALID_REQUEST', 'The request path is malformed.');
      return;
    }

    var rate = rateLimit(req.socket.remoteAddress || 'unknown');
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
      return;
    }

    var ctx = {
      req: req,
      res: res,
      params: parsed.searchParams,
      path: parsed.pathname,
      config: cfg,
      connectionLimit: connectionLimit,
      engine: engine,
      publicBaseUrl: publicBaseFromRequest(req, cfg),
      requestOptions: requestOptions
    };

    try {
      if (ctx.path === '/health' && req.method === 'GET') {
        healthHandler(ctx);
      } else if (ctx.path === '/api/detect' && req.method === 'GET') {
        await detectHandler(ctx);
      } else if (ctx.path === '/api/stream/info' && req.method === 'GET') {
        await streamInfoHandler(ctx);
      } else if (ctx.path === '/api/stream' &&
                 (req.method === 'GET' || req.method === 'HEAD')) {
        await streamHandler(ctx);
      } else {
        sendError(res, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
      }
    } catch (err) {
      sendRouteError(res, err);
    }
  });

  return {
    server: server,
    config: cfg,
    connectionLimit: connectionLimit,
    engine: engine,
    rateLimit: rateLimit
  };
}

module.exports = { createApp };
