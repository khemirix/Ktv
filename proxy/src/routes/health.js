'use strict';

const { sendJson } = require('../middleware/response');

function healthHandler(ctx) {
  sendJson(ctx.res, 200, {
    ok: true,
    status: 'ok',
    service: 'khemirix-smart-proxy',
    version: ctx.config.version,
    uptimeSeconds: Math.floor(process.uptime()),
    activeStreams: ctx.connectionLimit.count(),
    maxStreams: ctx.connectionLimit.limit(),
    processingEngine: ctx.config.processingEngine,
    timestamp: new Date().toISOString()
  });
}

module.exports = { healthHandler };
