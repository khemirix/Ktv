'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startUpstream, startProxy, apiUrl, json } = require('./helpers');

test('MPEG-TS stream data is forwarded progressively on GET and HEAD', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const get = await fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/stream.ts'));
    assert.equal(get.status, 200);
    assert.match(get.headers.get('content-type'), /video\/mp2t/);
    assert.equal(get.headers.get('x-proxy-format'), 'mpegts');
    const bytes = Buffer.from(await get.arrayBuffer());
    assert.equal(bytes[0], 0x47);
    assert.ok(bytes.length >= 188);

    const head = await fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/stream.ts'),
      { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-type'), /video\/mp2t/);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('Range requests are forwarded with status and headers intact', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const res = await fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/range'), {
      headers: { Range: 'bytes=10-19' }
    });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 10-19/100');
    assert.equal((await res.arrayBuffer()).byteLength, 10);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('client disconnect closes the upstream connection', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const controller = new AbortController();
    const res = await fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/slow'),
      { signal: controller.signal });
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.equal(first.value[0], 0x47);
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(upstream.slowClosed, true);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('long-running live TS delivers data without waiting for stream end', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const started = Date.now();
    const controller = new AbortController();
    const res = await fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/live'),
      { signal: controller.signal });
    const reader = res.body.getReader();
    const first = await reader.read();
    const elapsed = Date.now() - started;
    assert.equal(first.value[0], 0x47);
    assert.ok(elapsed < 2000, 'first bytes arrived before the live stream ended');
    controller.abort();
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('upstream failures and timeouts return safe diagnostics', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy({ env: { HEADERS_TIMEOUT_MS: '300' } });
  try {
    let r = await json(apiUrl(proxy.base, '/api/detect', 'http://127.0.0.1:1/offline'));
    assert.equal(r.status, 502);
    assert.equal(r.body.error.code, 'UPSTREAM_UNREACHABLE');

    r = await json(apiUrl(proxy.base, '/api/detect', upstream.base + '/never'));
    assert.equal(r.status, 504);
    assert.equal(r.body.error.code, 'UPSTREAM_TIMEOUT');
    assert.ok(!JSON.stringify(r.body).includes('127.0.0.1'));
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
