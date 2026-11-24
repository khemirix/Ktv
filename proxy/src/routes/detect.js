'use strict';

const { detectStream } = require('../detectors/detect');
const { streamUrlFrom } = require('../utils/request');
const { sendJson } = require('../middleware/response');

async function detectHandler(ctx) {
  var rawUrl = streamUrlFrom(ctx.params);
  var formatHint = ctx.params.get('format') || '';
  var result = await detectStream(rawUrl, Object.assign({}, ctx.requestOptions, {
    metadata: { format: formatHint }
  }));

  result.playbackUrl = ctx.publicBaseUrl
    ? ctx.publicBaseUrl + '/api/stream?url=' + encodeURIComponent(rawUrl)
    : '';
  sendJson(ctx.res, 200, result);
}

module.exports = { detectHandler };
