'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  startUpstream,
  startHttpsUpstream,
  startFallbackServers,
  startTlsSink,
  startProxy,
  apiUrl,
  json
} = require('./helpers');

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

test('first IPv4 address fails and the second validated IPv4 address succeeds', async () => {
  const pair = await startFallbackServers({ first: 'fail' });
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.2', family: 4 }
      ],
      maxAddressAttempts: 2,
      connectTimeoutMs: 800,
      connectionDeadlineMs: 5000,
      upstreamUserAgentProfile: 'vlc'
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', pair.base + '/stream.ts'));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
    assert.equal(pair.first.connections, 1, 'the first address must be attempted once');
    assert.ok(pair.second.requests.length > 0, 'the second address must be used');
    assert.equal(result.body.connection.addressCount, 2);
    assert.equal(result.body.connection.attempts[0].family, 4);
    assert.equal(result.body.connection.attempts[0].errorCode, 'UPSTREAM_UNREACHABLE');
    assert.ok(result.body.diagnostics.some(function (line) {
      return line.indexOf('attempt 1') !== -1 && line.indexOf('dns ') !== -1;
    }), 'safe diagnostics must describe the failed attempt');
    assert.ok(pair.second.userAgents[0].indexOf('VLC/') === 0,
      'VLC profile must be used when configured');
    assert.ok(pair.second.hosts[0].indexOf('stream.test:') === 0,
      'original hostname must be kept in the Host header');
    const report = JSON.stringify(result.body.connection) +
      result.body.diagnostics.join(' | ');
    assert.ok(!report.includes('127.0.0.1') && !report.includes('127.0.0.2'),
      'connection diagnostics must not expose fallback IP addresses');
  } finally {
    await proxy.close();
    await pair.close();
  }
});

test('IPv4 failure falls back to a validated IPv6 address', async () => {
  const pair = await startFallbackServers({ first: 'fail', secondHost: '::1' });
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ],
      maxAddressAttempts: 2,
      connectTimeoutMs: 800,
      connectionDeadlineMs: 5000
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', pair.base + '/stream.ts'));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
    assert.ok(pair.second.requests.length > 0);
    assert.equal(result.body.connection.attempts[1].family, 6);
    assert.equal(result.body.connection.attempts[0].family, 4);
  } finally {
    await proxy.close();
    await pair.close();
  }
});

test('TCP connection timeout is classified and bounded', async () => {
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [{ address: '192.0.2.1', family: 4 }],
      maxAddressAttempts: 1,
      connectTimeoutMs: 600,
      connectionDeadlineMs: 4000
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect',
      'http://stream.test:1234/stream.ts'));
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, 'CONNECT_TIMEOUT');
    assert.equal(result.body.error.diagnostics.attempts[0].tcpMs > 0, true);
    assert.ok(result.body.error.details[0].includes('tcp '));
  } finally {
    await proxy.close();
  }
});

test('TLS handshake timeout is classified separately from TCP', async () => {
  const sink = await startTlsSink();
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [{ address: '127.0.0.1', family: 4 }],
      maxAddressAttempts: 1,
      connectTimeoutMs: 1500,
      tlsTimeoutMs: 500,
      connectionDeadlineMs: 5000,
      rejectUnauthorized: false
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', sink.base + '/stream.ts'));
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, 'TLS_TIMEOUT');
    assert.equal(result.body.error.diagnostics.attempts[0].family, 4);
    assert.ok(result.body.error.details[0].includes('tls '));
  } finally {
    await proxy.close();
    await sink.close();
  }
});

test('slow response headers succeed with a generous budget and report header timing', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy({ headersTimeoutMs: '1500' });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect',
      upstream.base + '/slow-headers?delay=300'));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
    assert.ok(result.body.connection.attempts[0].headersMs >= 250,
      'header duration must be recorded');
    assert.ok(result.body.diagnostics[0].includes('headers '));
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('stalled live stream is closed by the resettable idle timeout', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy({ config: { idleTimeoutMs: 300 } });
  try {
    await assert.rejects(function () {
      return fetch(apiUrl(proxy.base, '/api/stream', upstream.base + '/stall'))
        .then(function (response) { return response.arrayBuffer(); });
    });
    await wait(120);
    assert.equal(upstream.slowClosed, true, 'stalled upstream socket must be closed');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('redirect to another validated hostname keeps validation and original Host/SNI', async () => {
  const pair = await startFallbackServers({ first: 'redirect' });
  const redirectUpstream = 'http://stream.test:' + pair.port + '/redirect';
  const proxy = await startProxy({
    allowPrivate: true,
    allowPrivateRedirects: true,
    requestOptions: {
      addressMap: {
        'stream.test': [{ address: '127.0.0.1', family: 4 }],
        'other.test': [{ address: '127.0.0.2', family: 4 }]
      },
      maxAddressAttempts: 1,
      connectionDeadlineMs: 5000
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', redirectUpstream));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
    assert.ok(pair.first.requests[0].indexOf('/redirect') !== -1);
    assert.ok(pair.second.requests[0].indexOf('/stream.ts') !== -1);
    assert.ok(pair.second.hosts[0].indexOf('other.test:') === 0);
  } finally {
    await proxy.close();
    await pair.close();
  }
});

test('client disconnect during connection fallback cancels and does not try the next address', async () => {
  const pair = await startFallbackServers({ first: 'hold' });
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.2', family: 4 }
      ],
      maxAddressAttempts: 2,
      connectTimeoutMs: 4000,
      headersTimeoutMs: 6000,
      connectionDeadlineMs: 10000
    }
  });
  try {
    const controller = new AbortController();
    const pending = fetch(apiUrl(proxy.base, '/api/detect',
      pair.base + '/stream.ts'), { signal: controller.signal });
    await wait(100);
    controller.abort();
    await assert.rejects(pending);
    await wait(150);
    assert.equal(pair.second.connections, 0,
      'abort must stop before the fallback address is attempted');
    assert.equal(pair.first.slowClosed, true, 'held socket must be closed on abort');
  } finally {
    await proxy.close();
    await pair.close();
  }
});

test('Host header and TLS SNI keep the original stream hostname', async () => {
  const upstream = await startHttpsUpstream();
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [{ address: '127.0.0.1', family: 4 }],
      maxAddressAttempts: 1,
      rejectUnauthorized: false
    }
  });
  try {
    const url = upstream.base.replace('localhost', 'stream.test') + '/stream.ts';
    const result = await json(apiUrl(proxy.base, '/api/detect', url));
    assert.equal(result.status, 200);
    assert.equal(result.body.format, 'mpegts');
    assert.ok(upstream.hosts[0].indexOf('stream.test:') === 0);
    assert.equal(upstream.servernames[0], 'stream.test');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('address attempts are bounded and fallback performs no extra DNS lookup', async () => {
  const pair = await startFallbackServers({ first: 'fail' });
  let dnsLookups = 0;
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.2', family: 4 }
      ],
      dnsLookup: async function () {
        dnsLookups += 1;
        throw new Error('unexpected DNS lookup during fallback');
      },
      maxAddressAttempts: 1,
      connectTimeoutMs: 800,
      connectionDeadlineMs: 4000
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', pair.base + '/stream.ts'));
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, 'UPSTREAM_UNREACHABLE');
    assert.equal(pair.first.connections, 1);
    assert.equal(pair.second.connections, 0, 'second address must not be tried');
    assert.equal(dnsLookups, 0, 'validated addresses must be reused without DNS');
    assert.equal(result.body.error.diagnostics.addressCount, 2);
  } finally {
    await proxy.close();
    await pair.close();
  }
});

test('overall connection deadline stops fallback before all addresses are tried', async () => {
  const pair = await startFallbackServers({ first: 'hold' });
  const proxy = await startProxy({
    allowPrivate: true,
    requestOptions: {
      addresses: [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.2', family: 4 }
      ],
      maxAddressAttempts: 2,
      headersTimeoutMs: 5000,
      connectionDeadlineMs: 700
    }
  });
  try {
    const result = await json(apiUrl(proxy.base, '/api/detect', pair.base + '/stream.ts'));
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, 'CONNECTION_DEADLINE_EXCEEDED');
    assert.equal(pair.second.connections, 0);
    await wait(100);
    assert.equal(pair.first.slowClosed, true);
  } finally {
    await proxy.close();
    await pair.close();
  }
});
