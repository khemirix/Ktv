'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  startUpstream,
  startHttpsUpstream,
  startProxy,
  apiUrl,
  json,
  buffer
} = require('./helpers');
const { resolveSafeAddress } = require('../src/security/validate-url');

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

test('working HTTP HLS source is detected and proxied with rewritten nested resources', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const detected = await json(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/hls/media.m3u8?token=abc'));
    assert.equal(detected.status, 200);
    assert.equal(detected.body.format, 'hls');
    assert.equal(detected.body.engine, 'hls.js');
    assert.ok(detected.body.playbackUrl.startsWith(proxy.base + '/api/stream?url='));

    const nested = await buffer(apiUrl(proxy.base, '/api/stream',
      upstream.base + '/hls/nested.m3u8?token=abc'));
    assert.equal(nested.status, 200);
    const variantMatch = /\/api\/stream\?url=([^\s]+)/.exec(nested.body.toString());
    assert.ok(variantMatch, 'master playlist must point at a proxied variant');
    const variantUpstreamUrl = decodeURIComponent(variantMatch[1]);
    const variantUrl = proxy.base + '/api/stream?url=' +
      encodeURIComponent(variantUpstreamUrl);

    const variant = await buffer(variantUrl);
    const body = variant.body.toString();
    assert.match(body, /\/api\/stream\?url=.*seg1\.m4s/);
    assert.match(body, /\/api\/stream\?url=.*seg2\.m4s/);
    assert.match(body, /URI="https?:\/\/.*\/api\/stream\?url=.*key\.bin/);
    assert.match(body, /URI="https?:\/\/.*\/api\/stream\?url=.*init\.mp4/);
    assert.ok(body.includes('token%3Dabc'), 'upstream token must be preserved');
    assert.equal(variant.headers.get('cache-control'), 'no-store');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('working HTTPS HLS source is detected and streamed through the proxy', async () => {
  const upstream = await startHttpsUpstream();
  const proxy = await startProxy({ requestOptions: { rejectUnauthorized: false } });
  try {
    const detected = await json(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/hls/media.m3u8?token=abc'));
    assert.equal(detected.status, 200);
    assert.equal(detected.body.format, 'hls');

    const streamed = await buffer(apiUrl(proxy.base, '/api/stream',
      upstream.base + '/hls/seg1.m4s?token=abc'));
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers.get('x-proxy-via'), 'smart-proxy');
    assert.ok(streamed.body.length > 0);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('slow headers succeed with a generous timeout and fail with a short one', async () => {
  const upstream = await startUpstream();
  const slowProxy = await startProxy({ headersTimeoutMs: '1500' });
  const fastProxy = await startProxy({ headersTimeoutMs: '500' });
  try {
    let result = await json(apiUrl(slowProxy.base, '/api/detect',
      upstream.base + '/slow-headers?delay=250'));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');

    result = await json(apiUrl(fastProxy.base, '/api/detect',
      upstream.base + '/slow-headers?delay=900'));
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, 'UPSTREAM_TIMEOUT');
    await wait(100);
    assert.equal(upstream.slowClosed, true, 'timed-out upstream socket must be closed');
  } finally {
    await fastProxy.close();
    await slowProxy.close();
    await upstream.close();
  }
});

test('DNS failure is classified safely and temporary lookup failures are retried', async () => {
  const proxy = await startProxy({
    allowPrivate: false,
    requestOptions: {
      dnsRetries: 0,
      dnsLookup: async function () {
        const err = new Error('name not found');
        err.code = 'ENOTFOUND';
        throw err;
      }
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect',
      'http://definitely-missing.invalid/live'));
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, 'DNS_FAILURE');
    assert.ok(!JSON.stringify(result.body).includes('definitely-missing.invalid/live'));
  } finally {
    await proxy.close();
  }

  let calls = 0;
  const resolved = await resolveSafeAddress('retry.test', {
    dnsTimeoutMs: 100,
    dnsRetries: 1,
    dnsRetryDelayMs: 0,
    dnsLookup: async function () {
      calls += 1;
      if (calls === 1) {
        const err = new Error('temporary failure');
        err.code = 'EAI_AGAIN';
        throw err;
      }
      return [{ address: '93.184.216.34', family: 4 }];
    }
  });
  assert.equal(calls, 2);
  assert.equal(resolved.address, '93.184.216.34');

  await assert.rejects(() => resolveSafeAddress('slow.test', {
    dnsTimeoutMs: 50,
    dnsRetries: 0,
    dnsLookup: function () { return new Promise(function () {}); }
  }), err => err.code === 'DNS_TIMEOUT');
});

test('HTTP to HTTPS redirects are followed and revalidated', async () => {
  const httpsUpstream = await startHttpsUpstream();
  const httpUpstream = await startUpstream();
  httpUpstream.httpsBase = httpsUpstream.base;
  const proxy = await startProxy({
    allowPrivateRedirects: true,
    requestOptions: { rejectUnauthorized: false }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect',
      httpUpstream.base + '/redirect-https'));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
  } finally {
    await proxy.close();
    await httpUpstream.close();
    await httpsUpstream.close();
  }
});

test('client disconnect during detection cancels the upstream request', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy({ headersTimeoutMs: '5000' });
  try {
    const controller = new AbortController();
    const pending = fetch(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/slow-headers?delay=2000'), { signal: controller.signal });
    await wait(60);
    controller.abort();
    await assert.rejects(pending);
    await wait(120);
    assert.equal(upstream.slowClosed, true, 'client disconnect must close upstream');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('unsupported formats and upstream HTTP errors keep safe diagnostics', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    let result = await json(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/unsupported'));
    assert.equal(result.body.format, 'unsupported');
    assert.equal(result.body.proxyStreamingSupported, false);

    result = await json(apiUrl(proxy.base, '/api/detect', upstream.base + '/error'));
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'UPSTREAM_HTTP_ERROR');
    assert.ok(!JSON.stringify(result.body).includes('127.0.0.1'));
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
