'use strict';

const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { copyUpstreamHeaders } = require('../utils/headers');
const { config } = require('../config');
const { readWithDecision } = require('./read');
const sniff = require('../detectors/sniff');
const { classifyBytes } = sniff;
const { rewritePlaylist } = require('../hls/rewrite');

function text(value) {
  return String(value === null || value === undefined ? '' : value);
}

function waitForDrain(res) {
  return new Promise(function (resolve, reject) {
    if (res.destroyed || res.writableEnded) {
      reject(new Error('CLIENT_CLOSED'));
      return;
    }
    function cleanup() {
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
    }
    function onDrain() { cleanup(); resolve(); }
    function onClose() { cleanup(); reject(new Error('CLIENT_CLOSED')); }
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

async function writeChunks(res, chunks) {
  for (var i = 0; i < chunks.length; i += 1) {
    if (!res.write(chunks[i])) await waitForDrain(res);
  }
}

async function forwardStream(opened, req, res, options) {
  options = options || {};
  var upstream = opened.response;
  var method = req.method || 'GET';
  var formatHeader = options.format || 'unknown';
  var engineHeader = options.engine || 'unknown';

  if (method === 'HEAD') {
    copyUpstreamHeaders(upstream, res, {
      'X-Proxy-Format': formatHeader,
      'X-Proxy-Engine': engineHeader,
      'X-Proxy-Via': 'smart-proxy'
    });
    res.end();
    if (opened.idleGuard) opened.idleGuard.dispose();
    return;
  }

  var hints = {
    url: opened.url,
    contentType: upstream.headers['content-type'],
    format: options.format
  };
  var first = await readWithDecision(upstream, {
    maxPlaylistBytes: options.maxPlaylistBytes || config.maxPlaylistBytes,
    classify: classifyBytes,
    hints: hints,
    onChunk: opened.idleGuard && opened.idleGuard.touch
  });
  var sniffed = classifyBytes(first.bytes);
  var playlistByHint = sniff.formatFromUrl(opened.url) === 'hls' ||
    sniff.formatFromContentType(upstream.headers['content-type']) === 'hls' ||
    text(options.format) === 'hls';
  var canRewrite = first.kind === 'playlist' && (sniffed === 'hls' || playlistByHint);

  if (canRewrite) {
    var rewritten = rewritePlaylist(first.bytes.toString('utf8'),
      opened.url, options.publicBaseUrl);
    copyUpstreamHeaders(upstream, res, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': null,
      'Content-Range': null,
      'X-Proxy-Format': 'hls',
      'X-Proxy-Engine': 'hls.js',
      'X-Proxy-Via': 'smart-proxy',
      'X-Proxy-Detection': first.truncated ? 'playlist-truncated'
        : (upstream.statusCode === 206 ? 'playlist-rewritten-range' : 'playlist-rewritten')
    });
    // A rewritten playlist is a complete document, even when the client asked
    // for a byte range. Serving 206 with a new body length would be invalid.
    if (upstream.statusCode === 206) res.statusCode = 200;
    res.end(rewritten);
    if (first.truncated) {
      try { upstream.destroy(); } catch (e) {}
    }
    return;
  }

  copyUpstreamHeaders(upstream, res, {
    'X-Proxy-Format': sniffed || formatHeader,
    'X-Proxy-Engine': engineHeader,
    'X-Proxy-Via': 'smart-proxy'
  });

  await writeChunks(res, first.chunks);
  if (first.ended || upstream.readableEnded) {
    res.end();
    if (opened.idleGuard) opened.idleGuard.dispose();
    return;
  }

  // pipeline() consumes the rest of the stream. The guard watches those chunks
  // without changing flow mode, and removes the listener when the stream ends.
  if (opened.idleGuard) opened.idleGuard.watchData();
  await pipeline(upstream, res);
}

module.exports = { forwardStream };
