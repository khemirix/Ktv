'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startUpstream, startProxy, apiUrl, json } = require('./helpers');

test('detection covers HLS, TS, extensionless TS, MP4, and unsupported data', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    async function detect(path) {
      return json(apiUrl(proxy.base, '/api/detect', upstream.base + path));
    }

    let r = await detect('/hls/media.m3u8?token=abc');
    assert.equal(r.status, 200);
    assert.equal(r.body.format, 'hls');
    assert.equal(r.body.engine, 'hls.js');
    assert.equal(r.body.confidence, 'high');
    assert.equal(r.body.appearsLive, false);
    assert.equal(r.body.playlist.isMedia, true);
    assert.ok(r.body.playbackUrl.indexOf('/api/stream?url=') !== -1);

    r = await detect('/hls/live.m3u8?token=abc');
    assert.equal(r.body.format, 'hls');
    assert.equal(r.body.appearsLive, true);

    r = await detect('/hls/master.m3u8?token=abc');
    assert.equal(r.body.format, 'hls');
    assert.equal(r.body.playlist.isMaster, true);
    assert.equal(r.body.appearsLive, null);

    r = await detect('/stream.ts');
    assert.equal(r.body.format, 'mpegts');
    assert.equal(r.body.engine, 'mpegts.js');
    assert.equal(r.body.appearsLive, true);

    r = await detect('/extensionless');
    assert.equal(r.body.format, 'mpegts');
    assert.equal(r.body.reason, 'content signature');

    r = await detect('/movie.mp4');
    assert.equal(r.body.format, 'mp4');
    assert.equal(r.body.engine, 'native');
    assert.equal(r.body.appearsLive, false);

    r = await detect('/hls/wrong.m3u8');
    assert.equal(r.body.format, 'hls');
    assert.ok(r.body.diagnostics.some(d => /Content-Type disagrees/.test(d)));

    r = await detect('/hls/incorrect.ts');
    assert.equal(r.body.format, 'mpegts');
    assert.equal(r.body.confidence, 'high');

    r = await detect('/unsupported');
    assert.equal(r.body.format, 'unsupported');
    assert.equal(r.body.engine, 'unknown');
    assert.equal(r.body.proxyStreamingSupported, false);

    const diagnostics = r.body.diagnostics.join(' ');
    assert.ok(!/token|abc|127\.0\.0\.1/.test(diagnostics),
      'diagnostics must not contain URLs or credentials');

    r = await json(apiUrl(proxy.base, '/api/stream/info', upstream.base + '/extensionless'));
    assert.equal(r.status, 200);
    assert.equal(r.body.detectedFormat, 'mpegts');
    assert.equal(r.body.recommendedEngine, 'mpegts.js');
    assert.ok(r.body.rangeSupported === true || r.body.rangeSupported === false);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('detection reports upstream and URL errors safely', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    let r = await json(apiUrl(proxy.base, '/api/detect', upstream.base + '/error'));
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'UPSTREAM_HTTP_ERROR');
    assert.ok(!JSON.stringify(r.body).includes('127.0.0.1'));

    r = await json(proxy.base + '/api/detect?url=' + encodeURIComponent('ftp://example.test/live'));
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'INVALID_PROTOCOL');

    r = await json(proxy.base + '/api/detect');
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'MISSING_URL');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
