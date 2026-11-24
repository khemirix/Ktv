'use strict';

const { detectStream } = require('../detectors/detect');
const { streamUrlFrom } = require('../utils/request');
const { sendJson } = require('../middleware/response');

async function streamInfoHandler(ctx) {
  var rawUrl = streamUrlFrom(ctx.params);
  var formatHint = ctx.params.get('format') || '';
  var result = await detectStream(rawUrl, Object.assign({}, ctx.requestOptions, {
    metadata: { format: formatHint }
  }));

  sendJson(ctx.res, 200, {
    ok: true,
    contentType: result.mimeType,
    detectedFormat: result.format,
    status: result.status,
    rangeSupported: result.rangeSupported,
    recommendedEngine: result.engine,
    appearsLive: result.appearsLive,
    confidence: result.confidence,
    diagnostics: result.diagnostics
  });
}

module.exports = { streamInfoHandler };
