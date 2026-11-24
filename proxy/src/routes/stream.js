'use strict';

const { openUpstream } = require('../stream/upstream');
const registry = require('../stream/registry');
const sniff = require('../detectors/sniff');
const { streamUrlFrom } = require('../utils/request');
const { clientRequestHeaders } = require('../utils/headers');
const { responseAbort } = require('../utils/abort');
const { sendRouteError } = require('../middleware/response');
const { proxyError } = require('../utils/errors');

async function streamHandler(ctx) {
  var rawUrl = streamUrlFrom(ctx.params);
  var formatHint = ctx.params.get('format') || '';

  if (!ctx.connectionLimit.acquire()) {
    throw proxyError(503, 'TOO_MANY_STREAMS', 'The proxy is at its connection limit.');
  }

  var released = false;
  var unregister = function () {};
  var upstream = null;
  var abort = responseAbort(ctx.res);

  function cleanup() {
    if (!released) {
      released = true;
      ctx.connectionLimit.release();
    }
    unregister();
    abort.dispose();
  }

  try {
    var opened = await openUpstream(rawUrl, Object.assign({}, ctx.requestOptions, {
      method: ctx.req.method || 'GET',
      headers: clientRequestHeaders(ctx.req),
      signal: abort.signal
    }));
    upstream = opened.response;

    unregister = registry.register(function () {
      try { opened.request.destroy(); } catch (e) {}
      try { opened.response.destroy(); } catch (e) {}
    });

    var finished = false;
    ctx.res.on('close', function () {
      if (finished) return;
      finished = true;
      cleanup();
      try { opened.request.destroy(); } catch (e) {}
      try { opened.response.destroy(); } catch (e) {}
    });

    var format = sniff.formatFromMetadata({ format: formatHint }) ||
      sniff.formatFromUrl(rawUrl) || 'unknown';
    var engine = sniff.recommendEngine(format);

    await ctx.engine.forward(opened, ctx.req, ctx.res, {
      format: format,
      engine: engine,
      publicBaseUrl: ctx.publicBaseUrl,
      peekBytes: ctx.config.peekBytes,
      maxPlaylistBytes: ctx.config.maxPlaylistBytes
    });
    finished = true;
    abort.complete();
  } catch (err) {
    abort.complete();
    if (!ctx.res.headersSent) sendRouteError(ctx.res, err);
    else if (upstream) {
      try { upstream.destroy(); } catch (e) {}
      if (!ctx.res.writableEnded) ctx.res.destroy();
    }
  } finally {
    cleanup();
  }
}

module.exports = { streamHandler };
