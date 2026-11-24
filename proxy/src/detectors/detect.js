'use strict';

const { openUpstream } = require('../stream/upstream');
const { collectUpTo } = require('../stream/read');
const { config } = require('../config');
const { upstreamRequestHeaders } = require('../utils/headers');
const { proxyError } = require('../utils/errors');
const sniff = require('./sniff');
const { parsePlaylist } = require('./playlist');

function combine(probe) {
  var diagnostics = [];
  var sniffed = probe.sniffed;
  var fromType = probe.contentTypeFormat;
  var fromUrl = probe.urlFormat;
  var fromMeta = probe.metadataFormat;

  if (sniffed && sniffed !== 'document' && sniffed !== 'unsupported') {
    if (fromType && fromType !== sniffed) {
      diagnostics.push('Content-Type disagrees with the response bytes; bytes were trusted.');
    }
    return {
      format: sniffed,
      confidence: 'high',
      reason: 'content signature',
      diagnostics: diagnostics
    };
  }

  if (sniffed === 'document' || fromType === 'document') {
    diagnostics.push('The upstream returned an HTML or text document instead of media.');
    return {
      format: 'unsupported',
      confidence: 'high',
      reason: 'document response',
      diagnostics: diagnostics
    };
  }

  if (sniffed === 'unsupported') {
    diagnostics.push('The response contains an unsupported container signature.');
    return {
      format: 'unsupported',
      confidence: 'high',
      reason: 'unsupported signature',
      diagnostics: diagnostics
    };
  }

  if (fromType) {
    return {
      format: fromType,
      confidence: 'medium',
      reason: 'Content-Type',
      diagnostics: diagnostics
    };
  }

  if (fromMeta) {
    diagnostics.push('Format was taken from channel metadata; the response was inconclusive.');
    return {
      format: fromMeta,
      confidence: 'low',
      reason: 'channel metadata',
      diagnostics: diagnostics
    };
  }

  if (fromUrl) {
    diagnostics.push('Format was inferred from the URL extension only.');
    return {
      format: fromUrl,
      confidence: 'low',
      reason: 'URL extension',
      diagnostics: diagnostics
    };
  }

  diagnostics.push('No reliable format signal was available.');
  return {
    format: 'unknown',
    confidence: 'low',
    reason: 'inconclusive',
    diagnostics: diagnostics
  };
}

function liveStatus(format, playlist) {
  if (format === 'mpegts') return true;
  if (format === 'mp4' || format === 'webm' || format === 'ogg') return false;
  if (format === 'hls' && playlist && playlist.isMedia) return !playlist.hasEndList;
  if (format === 'hls' && playlist && playlist.isMaster) return null;
  return null;
}

async function detectStream(rawUrl, options) {
  options = options || {};
  var maxBytes = options.detectMaxBytes || config.detectMaxBytes;
  var headers = upstreamRequestHeaders({}, Object.assign({}, config, options));
  headers.Range = 'bytes=0-' + (maxBytes - 1);
  Object.assign(headers, options.headers || {});

  var opened = await openUpstream(rawUrl, Object.assign({}, options, {
    method: 'GET',
    headers: headers
  }));

  try {
    var collected = await collectUpTo(
      opened.response,
      maxBytes,
      opened.idleGuard && opened.idleGuard.touch
    );
    var upstreamStatus = opened.response.statusCode || 0;
    if (upstreamStatus >= 400) {
      throw proxyError(upstreamStatus, 'UPSTREAM_HTTP_ERROR',
        'The upstream stream returned HTTP ' + upstreamStatus + '.');
    }
    var contentType = opened.response.headers['content-type'] || '';
    var sniffed = sniff.classifyBytes(collected.bytes);
    var playlist = sniffed === 'hls'
      ? parsePlaylist(collected.bytes.toString('utf8'))
      : null;

    var resolved = combine({
      sniffed: sniffed,
      contentTypeFormat: sniff.formatFromContentType(contentType),
      urlFormat: sniff.formatFromUrl(rawUrl),
      metadataFormat: sniff.formatFromMetadata(options.metadata)
    });

    var rangeHeader = opened.response.headers['accept-ranges'] || '';
    var rangeSupported = /bytes/i.test(rangeHeader) || !!opened.response.headers['content-range'];
    var format = resolved.format;
    var mimeType = sniff.mimeOf(contentType) ||
      (format === 'unknown' || format === 'unsupported'
        ? 'application/octet-stream' : sniff.expectedMime(format));

    return {
      ok: true,
      format: format,
      mimeType: mimeType,
      engine: sniff.recommendEngine(format),
      appearsLive: liveStatus(format, playlist),
      proxyStreamingSupported: ['hls', 'mpegts', 'mp4', 'webm', 'ogg'].indexOf(format) !== -1,
      confidence: resolved.confidence,
      reason: resolved.reason,
      diagnostics: resolved.diagnostics.concat(opened.diagnostics || []),
      connection: opened.connection || null,
      status: upstreamStatus,
      rangeSupported: rangeSupported,
      playlist: playlist,
      detectedBytes: collected.total
    };
  } finally {
    try { opened.response.destroy(); } catch (e) {}
  }
}

module.exports = { detectStream, combine, liveStatus };
