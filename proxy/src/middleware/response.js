'use strict';

const { ProxyError } = require('../utils/errors');

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message, extra) {
  var body = {
    ok: false,
    error: { code: code || 'REQUEST_FAILED', message: message || 'The request failed.' }
  };
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  sendJson(res, status, body);
}

function sendRouteError(res, err) {
  if (err instanceof ProxyError && err.expose) {
    sendError(res, err.status || 500, err.code, err.message);
    return;
  }
  sendError(res, 500, 'INTERNAL_ERROR', 'The proxy could not complete the request.');
}

module.exports = { sendJson, sendError, sendRouteError };
