'use strict';

const assert = require('assert');
const StreamDetector = require('../js/stream-detector.js');

function bytesOf(value) {
  return new Uint8Array(Buffer.from(value, 'binary'));
}

function tsBytes() {
  const out = new Uint8Array(400);
  for (let i = 0; i < out.length; i += 188) {
    out[i] = 0x47;
    out[i + 1] = 0x40;
  }
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === 0) out[i] = 0x11;
  }
  return out;
}

function response(status, contentType, bytes) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      }
    },
    body: {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: bytes || new Uint8Array(0) });
          },
          cancel() { return Promise.resolve(); }
        };
      }
    }
  };
}

function videoStub(canPlay) {
  return {
    canPlayType(type) { return canPlay && canPlay.indexOf(type) !== -1 ? 'probably' : ''; }
  };
}

function hlsStub(supported) {
  return {
    isSupported() { return supported; },
    Events: { MANIFEST_PARSED: 'manifest', ERROR: 'error' }
  };
}

function mpegtsStub(supported) {
  return {
    isSupported() { return supported; },
    Events: { ERROR: 'error' },
    createPlayer() { return {}; }
  };
}

async function run() {
  let checks = 0;
  function ok(condition, label) {
    assert.ok(condition, label);
    checks += 1;
  }

  // 1. Playlist signature wins over a misleading ".ts" URL.
  {
    const original = global.fetch;
    global.fetch = () => Promise.resolve(response(
      200, 'application/octet-stream', bytesOf('#EXTM3U\n#EXT-X-VERSION:3\n')));
    const result = await StreamDetector.detect('http://example.test/channel.ts', {
      proxy: 'https://proxy.test',
      env: {
        video: videoStub([]),
        Hls: hlsStub(true),
        mpegts: mpegtsStub(true)
      }
    });
    ok(result.format === 'hls', 'playlist signature identifies HLS');
    ok(result.engine === 'hls.js', 'playlist signature routes to Hls.js');
    ok(result.reason === 'content signature', 'playlist reason is content signature');
    global.fetch = original;
  }

  // 2. Extensionless MPEG-TS is identified from packet signatures.
  {
    const original = global.fetch;
    global.fetch = () => Promise.resolve(response(200, 'application/octet-stream', tsBytes()));
    const result = await StreamDetector.detect('http://example.test/live/1784937', {
      proxy: 'https://proxy.test',
      env: {
        video: videoStub([]),
        Hls: hlsStub(true),
        mpegts: mpegtsStub(true)
      }
    });
    ok(result.format === 'mpegts', 'extensionless TS identified from bytes');
    ok(result.engine === 'mpegts.js', 'extensionless TS routes to mpegts.js');
    ok(result.via === 'direct', 'working direct URL is preferred over proxy');
    global.fetch = original;
  }

  // 3. Content-Type selects MPEG-TS when bytes are inconclusive.
  {
    const original = global.fetch;
    global.fetch = () => Promise.resolve(response(200, 'video/mp2t', bytesOf('0123456789')));
    const result = await StreamDetector.detect('http://example.test/stream', {
      env: { video: videoStub([]), Hls: hlsStub(false), mpegts: mpegtsStub(true) }
    });
    ok(result.format === 'mpegts', 'video/mp2t content type selects MPEG-TS');
    ok(result.confidence === 'medium', 'content-type detection is medium confidence');
    global.fetch = original;
  }

  // 4. Progressive MP4 uses native video.
  {
    const original = global.fetch;
    const mp4 = bytesOf('\x00\x00\x00\x18ftypisom');
    global.fetch = () => Promise.resolve(response(200, 'video/mp4', mp4));
    const result = await StreamDetector.detect('http://example.test/movie.bin', {
      env: {
        video: videoStub(['video/mp4']),
        Hls: hlsStub(true),
        mpegts: mpegtsStub(true)
      }
    });
    ok(result.format === 'mp4', 'MP4 ftyp signature identifies MP4');
    ok(result.engine === 'native', 'MP4 uses native video');
    global.fetch = original;
  }

  // 5. HTML is reported as unsupported, not sent to mpegts.js.
  {
    const original = global.fetch;
    global.fetch = () => Promise.resolve(response(200, 'text/html', bytesOf('<!doctype html><html>...')));
    const result = await StreamDetector.detect('http://example.test/stream', {
      env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
    });
    ok(result.format === 'unsupported', 'HTML response is unsupported');
    ok(result.engine === null, 'unsupported format has no engine');
    ok(/server-side transcoding/i.test(result.message), 'unsupported message explains transcoding');
    global.fetch = original;
  }

  // 6. Direct rejection falls through to the proxy and warns the user.
  {
    const original = global.fetch;
    global.fetch = (url) => {
      if (String(url).indexOf('proxy.test') !== -1) {
        return Promise.resolve(response(200, 'video/mp2t', tsBytes()));
      }
      return Promise.resolve(response(403, 'text/html', bytesOf('forbidden')));
    };
    const result = await StreamDetector.detect('http://example.test/live/secure', {
      proxy: 'https://proxy.test',
      env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
    });
    ok(result.via === 'proxy', 'direct failure falls back to proxy');
    ok(result.mediaUrl.indexOf('proxy.test/fetch?url=') !== -1, 'proxy URL is used for playback');
    ok(result.warnings.some(w => /rejected access/i.test(w)), 'direct rejection becomes a warning');
    global.fetch = original;
  }

  // 7. Expired streams produce a specific fatal error.
  {
    const original = global.fetch;
    global.fetch = () => Promise.resolve(response(403, 'text/html', bytesOf('forbidden')));
    let error = null;
    try {
      await StreamDetector.detect('http://example.test/expired', {
        proxy: 'https://proxy.test',
        env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
      });
    } catch (e) { error = e; }
    ok(!!error, 'expired stream rejects detection');
    ok(/expired or require a valid subscription/i.test(error.message), '403 explains expiry/access');
    ok(error.kind === 'proxy', 'final failure is classified as proxy-side');
    global.fetch = original;
  }

  // 8. Proxy connection failure is distinct from upstream errors.
  {
    const original = global.fetch;
    global.fetch = (url) => {
      if (String(url).indexOf('proxy.test') !== -1) {
        return Promise.reject(new Error('network down'));
      }
      return Promise.reject(new Error('direct down'));
    };
    let error = null;
    try {
      await StreamDetector.detect('http://example.test/offline', {
        proxy: 'https://proxy.test',
        env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
      });
    } catch (e) { error = e; }
    ok(!!error && /Could not reach the stream proxy/i.test(error.message),
      'proxy failure has its own message');
    ok(error.kind === 'proxy', 'proxy failure kind is reported');
    global.fetch = original;
  }

  // 9. Channel metadata is a safe fallback when probing is impossible.
  {
    const original = global.fetch;
    global.fetch = () => Promise.reject(new Error('offline'));
    const result = await StreamDetector.detect('http://example.test/no-probe', {
      proxy: 'https://proxy.test',
      metadata: { format: 'mpegts' },
      allowMetadataFallback: true,
      env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
    });
    ok(result.format === 'mpegts', 'metadata fallback supplies format');
    ok(result.via === 'metadata', 'metadata fallback is labelled');
    ok(result.engine === 'mpegts.js', 'metadata fallback selects MPEG-TS engine');
    ok(result.warnings.length === 1, 'metadata fallback includes a warning');
    global.fetch = original;
  }

  // 10. An unsupported direct response still tries the proxy.
  {
    const original = global.fetch;
    global.fetch = (url) => {
      if (String(url).indexOf('proxy.test') !== -1) {
        return Promise.resolve(response(200, 'video/mp2t', tsBytes()));
      }
      return Promise.resolve(response(200, 'text/html', bytesOf('<!doctype html><html>')));
    };
    const result = await StreamDetector.detect('http://example.test/needs-proxy', {
      proxy: 'https://proxy.test',
      env: { video: videoStub([]), Hls: hlsStub(true), mpegts: mpegtsStub(true) }
    });
    ok(result.via === 'proxy', 'unsupported direct response falls through to proxy');
    ok(result.format === 'mpegts', 'proxy response is used when direct page is unsupported');
    global.fetch = original;
  }

  // 11. Byte sniffing helper covers the primary signatures.
  ok(StreamDetector.sniffBytes(bytesOf('#EXTM3U')) === 'hls', 'sniff: playlist');
  ok(StreamDetector.sniffBytes(tsBytes()) === 'mpegts', 'sniff: TS packets');
  ok(StreamDetector.sniffBytes(bytesOf('\x00\x00\x00\x18ftypisom')) === 'mp4', 'sniff: MP4');
  ok(StreamDetector.sniffBytes(bytesOf('\x1a\x45\xdf\xa3more')) === 'webm', 'sniff: Matroska/WebM');
  ok(StreamDetector.sniffBytes(bytesOf('\x00\x01\x02\x03')) === null, 'sniff: unknown stays unknown');

  console.log('stream-detector.test.js: ' + checks + ' checks passed');
}

run().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
