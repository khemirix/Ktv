'use strict';

// Extensionless stream detection checks: MIME classification, byte sniffing,
// redirects, auth headers, manifest inspection, and conservative fallback.
// Run with: node tests/stream-detector.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'stream-detector.js'), 'utf8');

function makeContext(fetchImpl) {
  const ctx = { fetch: fetchImpl, AbortController, setTimeout, clearTimeout, console };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'stream-detector.js' });
  return ctx.StreamDetector;
}

function response(options) {
  const opts = options || {};
  const headers = opts.headers || {};
  let bytes = opts.bytes || [];
  return {
    status: opts.status === undefined ? 200 : opts.status,
    url: opts.url || '',
    type: opts.type || 'basic',
    headers: {
      get(name) {
        const key = Object.keys(headers).find((h) => h.toLowerCase() === String(name).toLowerCase());
        return key ? headers[key] : null;
      }
    },
    body: bytes.length ? {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: new Uint8Array(bytes) });
          },
          cancel() { return Promise.resolve(); }
        };
      }
    } : null,
    text() { return Promise.resolve(Buffer.from(bytes).toString('utf8')); }
  };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

(async () => {
  const Detector = makeContext(() => Promise.reject(new Error('no fetch in this check')));

  await check('MIME and extension classification keeps extensionless URLs unknown', () => {
    assert.strictEqual(Detector.mimeKind('application/vnd.apple.mpegurl; charset=utf-8'), 'hls');
    assert.strictEqual(Detector.mimeKind('video/mp2t'), 'mpegts');
    assert.strictEqual(Detector.mimeKind('video/x-matroska'), 'progressive');
    assert.strictEqual(Detector.mimeKind('application/octet-stream'), 'ambiguous');
    assert.strictEqual(Detector.extensionKind('http://host/account/12345/3634'), '');
    assert.strictEqual(Detector.extensionKind('http://host/live/a.m3u8?token=1'), 'hls');
  });

  await check('byte sniffing recognises HLS, TS, MP4, and Matroska signatures', () => {
    assert.strictEqual(Detector.sniffBytes(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3', 'utf8')), 'hls');
    const ts = new Array(189).fill(0);
    ts[0] = 0x47; ts[188] = 0x47;
    assert.strictEqual(Detector.sniffBytes(ts), 'mpegts');
    const mp4 = new Array(16).fill(0);
    mp4[4] = 0x66; mp4[5] = 0x74; mp4[6] = 0x79; mp4[7] = 0x70;
    assert.strictEqual(Detector.sniffBytes(mp4), 'progressive');
    assert.strictEqual(Detector.sniffBytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), 'progressive');
  });

  await check('explicit MIME override wins without any network request', async () => {
    const result = await Detector.fromMetadata('http://host/account/12345/3634', {
      mime: 'video/mp2t',
      headers: { Authorization: 'Bearer test-token' }
    });
    assert.strictEqual(result.kind, 'mpegts');
    assert.strictEqual(result.source, 'metadata');
    assert.strictEqual(result.headers.Authorization, 'Bearer test-token');
  });

  await check('Content-Type wins and redirect final URL is returned', async () => {
    const calls = [];
    const d = makeContext((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(response({
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        url: 'https://cdn.example/final/playlist.m3u8'
      }));
    });
    const result = await d.detect('https://origin.example/account/12345/3634', {
      headers: { 'X-Auth': 'token' },
      credentials: 'include'
    });
    assert.strictEqual(result.kind, 'hls');
    assert.strictEqual(result.source, 'content-type');
    assert.strictEqual(result.finalUrl, 'https://cdn.example/final/playlist.m3u8');
    assert.strictEqual(calls[0].init.headers['X-Auth'], 'token');
    assert.strictEqual(calls[0].init.credentials, 'include');
    assert.strictEqual(calls[0].init.redirect, 'follow');
  });

  await check('ambiguous Content-Type falls back to prefix sniffing with Range GET', async () => {
    const ts = new Array(189).fill(0);
    ts[0] = 0x47; ts[188] = 0x47;
    const calls = [];
    const d = makeContext((url, init) => {
      calls.push(init.method);
      if (init.method === 'HEAD') {
        return Promise.resolve(response({ headers: { 'content-type': 'application/octet-stream' } }));
      }
      return Promise.resolve(response({
        headers: { 'content-type': 'application/octet-stream' },
        bytes: ts
      }));
    });
    const result = await d.detect('http://host/account/12345/3634');
    assert.deepStrictEqual(calls, ['HEAD', 'GET']);
    assert.strictEqual(result.kind, 'mpegts');
    assert.strictEqual(result.source, 'content-sniff');
  });

  await check('failed detection does not force HLS on an extensionless URL', async () => {
    const d = makeContext(() => Promise.reject(new Error('network down')));
    const unknown = await d.detect('http://host/account/12345/3634');
    assert.strictEqual(unknown.kind, 'unknown');
    assert.strictEqual(unknown.source, 'detection-failed');
    const tsHint = await d.detect('http://host/account/12345/3632.ts');
    assert.strictEqual(tsHint.kind, 'mpegts');
    assert.strictEqual(tsHint.source, 'extension-fallback');
  });

  await check('errors never include stream URLs or tokens', async () => {
    const d = makeContext(() => Promise.resolve(response({ status: 403 })));
    const result = await d.detect('http://host/secret/token-abc123');
    assert.strictEqual(JSON.stringify(result).indexOf('token-abc123'), -1);
  });

  console.log('stream detector tests passed (' + passed + ' checks)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
