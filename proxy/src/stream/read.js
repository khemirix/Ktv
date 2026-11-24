'use strict';

function concat(chunks, total) {
  return Buffer.concat(chunks, Math.min(total, chunks.reduce(function (sum, c) {
    return sum + c.length;
  }, 0)));
}

// Reads at most maxBytes. When the limit is reached the response is paused and
// the buffered chunks are returned so the caller can continue piping later.
function peek(response, maxBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var total = 0;
    var settled = false;

    function cleanup() {
      response.removeListener('data', onData);
      response.removeListener('end', onEnd);
      response.removeListener('error', onError);
    }
    function finish(ended) {
      if (settled) return;
      settled = true;
      cleanup();
      response.pause();
      resolve({ chunks: chunks, total: total, bytes: concat(chunks, total), ended: !!ended });
    }
    function onData(chunk) {
      var buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      total += buffer.length;
      // Resolve as soon as the first chunk arrives. Live streams may never
      // reach maxBytes and must not be delayed waiting for more data.
      finish(false);
    }
    function onEnd() { finish(true); }
    function onError(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    response.on('data', onData);
    response.on('end', onEnd);
    response.on('error', onError);
    response.resume();
  });
}

// Collects a bounded body (playlists, detection prefixes). The response is
// destroyed once the limit is reached.
function collectUpTo(response, maxBytes, onChunk) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var total = 0;
    var settled = false;

    function cleanup() {
      response.removeListener('data', onData);
      response.removeListener('end', onEnd);
      response.removeListener('error', onError);
    }
    function finish(ended, truncated) {
      if (settled) return;
      settled = true;
      cleanup();
      if (truncated) {
        try { response.destroy(); } catch (e) {}
      }
      resolve({ bytes: concat(chunks, total), total: total, ended: !!ended, truncated: !!truncated });
    }
    function onData(chunk) {
      var buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (onChunk) onChunk(buffer);
      var remaining = maxBytes - total;
      if (remaining > 0) chunks.push(buffer.slice(0, remaining));
      total += buffer.length;
      if (total >= maxBytes) finish(false, true);
    }
    function onEnd() { finish(true, false); }
    function onError(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    response.on('data', onData);
    response.on('end', onEnd);
    response.on('error', onError);
    response.resume();
  });
}

// Reads the first bytes, holds them only when they are an HLS playlist, and
// otherwise releases them immediately for progressive forwarding.
function readWithDecision(response, options) {
  options = options || {};
  var maxPlaylistBytes = options.maxPlaylistBytes || 1048576;
  var classify = options.classify || function () { return null; };

  return new Promise(function (resolve, reject) {
    var chunks = [];
    var total = 0;
    var mode = 'undecided';
    var settled = false;

    function snapshot() {
      var length = chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
      return Buffer.concat(chunks, Math.min(total, length));
    }

    function finish(kind, truncated) {
      if (settled) return;
      settled = true;
      response.removeListener('data', onData);
      response.removeListener('end', onEnd);
      response.removeListener('error', onError);
      response.pause();
      resolve({
        kind: kind,
        chunks: chunks,
        total: total,
        bytes: snapshot(),
        ended: response.readableEnded === true,
        truncated: !!truncated
      });
    }

    function onData(chunk) {
      var buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (options.onChunk) options.onChunk(buffer);
      chunks.push(buffer);
      total += buffer.length;

      if (mode === 'undecided') {
        if (classify(snapshot()) === 'hls') {
          mode = 'playlist';
        } else {
          finish('prefix', false);
          return;
        }
      }
      if (mode === 'playlist' && total >= maxPlaylistBytes) {
        finish('playlist', true);
      }
    }

    function onEnd() {
      finish(mode === 'playlist' ? 'playlist' : 'prefix', false);
    }

    function onError(err) {
      if (settled) return;
      settled = true;
      response.removeListener('data', onData);
      response.removeListener('end', onEnd);
      response.removeListener('error', onError);
      reject(err);
    }

    response.on('data', onData);
    response.on('end', onEnd);
    response.on('error', onError);
    response.resume();
  });
}

module.exports = { peek, collectUpTo, readWithDecision };
