'use strict';

const crypto = require('node:crypto');
const { diagnoseTcpHost } = require('../diagnostics/tcp');
const { config: defaultConfig } = require('../config');
const { proxyError } = require('../utils/errors');
const { sendError, sendJson } = require('../middleware/response');

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

async function tcpDiagnosticsHandler(ctx) {
  var cfg = ctx.config || defaultConfig;

  // Hidden unless explicitly enabled. A missing token is treated as disabled.
  if (!cfg.allowTcpDiagnostics || !cfg.diagnosticsToken) {
    sendError(ctx.res, 404, 'NOT_FOUND', 'The requested endpoint does not exist.');
    return;
  }

  // Node preserves underscores in header names, so DIAGNOSTICS_TOKEN arrives
  // as diagnostics_token. A hyphenated alias is accepted for HTTP clients.
  var providedToken = ctx.req.headers['diagnostics_token'] ||
    ctx.req.headers['diagnostics-token'] ||
    ctx.req.headers['x-diagnostics-token'];
  if (!tokenMatches(providedToken, cfg.diagnosticsToken)) {
    sendError(ctx.res, 401, 'UNAUTHORIZED', 'A valid diagnostics token is required.');
    return;
  }

  var keys = Array.from(ctx.params.keys());
  if (keys.some(function (key) { return key !== 'host' && key !== 'port'; })) {
    throw proxyError(400, 'INVALID_REQUEST',
      'Only host and port parameters are accepted.');
  }
  if (ctx.params.getAll('host').length !== 1 ||
      ctx.params.getAll('port').length !== 1) {
    throw proxyError(400, 'INVALID_REQUEST',
      'Exactly one host and one port are required.');
  }

  var result = await diagnoseTcpHost(ctx.params.get('host'), ctx.params.get('port'), {
    maxUrlLength: cfg.maxUrlLength,
    dnsTimeoutMs: cfg.dnsTimeoutMs,
    dnsRetries: cfg.dnsRetries,
    dnsRetryDelayMs: cfg.dnsRetryDelayMs,
    connectTimeoutMs: cfg.connectTimeoutMs,
    connectionDeadlineMs: cfg.connectionDeadlineMs,
    maxAddressAttempts: cfg.maxAddressAttempts,
    validationOptions: ctx.tcpDiagnosticsValidationOptions || undefined,
    connector: ctx.tcpDiagnosticsConnector || undefined
  });

  sendJson(ctx.res, 200, result);
}

module.exports = { tcpDiagnosticsHandler, tokenMatches };
