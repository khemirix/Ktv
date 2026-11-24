'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isUnsafeIp } = require('../src/security/ip');
const { validateUrl } = require('../src/security/validate-url');
const { createRateLimiter } = require('../src/security/rate-limit');
const { createConnectionLimit } = require('../src/security/connection-limit');
const { redactUrl } = require('../src/utils/redact');
const { startUpstream, startProxy, apiUrl, json } = require('./helpers');

test('IP classifier blocks private, loopback, link-local, CGNAT, and metadata ranges', () => {
  ['127.0.0.1', '10.0.0.5', '172.16.4.2', '192.168.1.10',
   '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1',
   '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
   '::127.0.0.1', '::7f00:1', '::ffff:0:127.0.0.1',
   '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:3fff:fdd2'].forEach(ip => {
    assert.equal(isUnsafeIp(ip), true, ip + ' should be blocked');
  });
  ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111',
   '::ffff:8.8.8.8'].forEach(ip => {
    assert.equal(isUnsafeIp(ip), false, ip + ' should be allowed');
  });
});

test('URL validation restricts protocols, credentials, length, and private hosts', async () => {
  await assert.rejects(() => validateUrl('ftp://example.test/live'),
    err => err.code === 'INVALID_PROTOCOL');
  await assert.rejects(() => validateUrl('http://user:pass@example.test/live'),
    err => err.code === 'INVALID_URL');
  await assert.rejects(() => validateUrl('http://127.0.0.1:8080/live'),
    err => err.code === 'BLOCKED_ADDRESS');
  await assert.rejects(() => validateUrl('http://169.254.169.254/latest/meta-data'),
    err => err.code === 'BLOCKED_ADDRESS');
  await assert.rejects(() => validateUrl('http://example.test/' + 'a'.repeat(9000)),
    err => err.code === 'INVALID_URL');
});

test('URL validation keeps all validated public addresses, IPv4 first', async () => {
  let lookups = 0;
  const resolved = await validateUrl('http://example.test/live', {
    dnsLookup: async function () {
      lookups += 1;
      return [
        { address: '2606:4700::1111', family: 6 },
        { address: '93.184.216.34', family: 4 },
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ];
    }
  });

  assert.equal(lookups, 1);
  assert.equal(resolved.pinned, true);
  assert.equal(resolved.address, '93.184.216.34');
  assert.deepEqual(resolved.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700::1111', family: 6 }
  ]);
});

test('rate limiter and connection limiter enforce configured bounds', () => {
  const limit = createRateLimiter({ windowMs: 60000, max: 2 });
  assert.equal(limit('client-a').allowed, true);
  assert.equal(limit('client-a').allowed, true);
  assert.equal(limit('client-a').allowed, false);
  assert.equal(limit('client-b').allowed, true);

  const connections = createConnectionLimit(1);
  assert.equal(connections.acquire(), true);
  assert.equal(connections.acquire(), false);
  connections.release();
  assert.equal(connections.acquire(), true);
});

test('logs never contain credentials or query strings', () => {
  const redacted = redactUrl('http://diaspora.example/habib/token/123?key=secret');
  assert.ok(!redacted.includes('token'));
  assert.ok(!redacted.includes('secret'));
  assert.ok(redacted.includes('diaspora.example'));
});

test('redirects are revalidated before connecting', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    let r = await json(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/redirect-private'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'BLOCKED_ADDRESS');

    const redirectProxy = await startProxy({ allowPrivateRedirects: true });
    try {
      r = await json(apiUrl(redirectProxy.base, '/api/detect',
        upstream.base + '/redirect-public'));
      assert.equal(r.status, 200);
      assert.equal(r.body.format, 'mpegts');
    } finally {
      await redirectProxy.close();
    }
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
