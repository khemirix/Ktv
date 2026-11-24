'use strict';

const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { copyUpstreamHeaders } = require('../utils/headers');
const { config } = require('../config');
const { readWithDecision } = require('./read');
const { classifyBytes } = require('../detectors/sniff');
const { rewritePlaylist } = require('../hls/rewrite');

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
    return;
  }

  var first = await readWithDecision(upstream, {
    maxPlaylistBytes: options.maxPlaylistBytes || config.maxPlaylistBytes,
    classify: classifyBytes
  });
  var sniffed = classifyBytes(first.bytes);
  var canRewrite = first.kind === 'playlist' &&
    sniffed === 'hls' && upstream.statusCode !== 206;

  if (canRewrite) {
    var rewritten = rewritePlaylist(first.bytes.toString('utf8'),
      opened.url, options.publicBaseUrl);
    copyUpstreamHeaders(upstream, res, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': null,
      'X-Proxy-Format': 'hls',
      'X-Proxy-Engine': 'hls.js',
      'X-Proxy-Via': 'smart-proxy',
      'X-Proxy-Detection': first.truncated ? 'playlist-truncated' : 'playlist-rewritten'
    });
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
    return;
  }
  await pipeline(upstream, res);
}

module.exports = { forwardStream };
