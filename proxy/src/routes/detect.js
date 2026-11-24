'use strict';

const { detectStream } = require('../detectors/detect');
const { streamUrlFrom } = require('../utils/request');
const { sendJson } = require('../middleware/response');
const { responseAbort } = require('../utils/abort');

async function detectHandler(ctx) {
  var rawUrl = streamUrlFrom(ctx.params);
  var formatHint = ctx.params.get('format') || '';
  var abort = responseAbort(ctx.res);

  try {
    var result = await detectStream(rawUrl, Object.assign({}, ctx.requestOptions, {
      metadata: { format: formatHint },
      signal: abort.signal
    }));

    result.playbackUrl = ctx.publicBaseUrl
      ? ctx.publicBaseUrl + '/api/stream?url=' + encodeURIComponent(rawUrl)
      : '';
    abort.complete();
    sendJson(ctx.res, 200, result);
  } finally {
    abort.dispose();
  }
}

module.exports = { detectHandler };
