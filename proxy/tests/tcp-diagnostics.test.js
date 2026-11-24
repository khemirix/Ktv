'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { diagnoseTcpHost } = require('../src/diagnostics/tcp');
const { startUpstream, startProxy } = require('./helpers');

const PUBLIC_IP = '93.184.216.34';
const TOKEN = 'unit-test-token-' + process.pid;

function addressMap(address, family) {
  return { addressMap: { 'diag.example.test': [{ address: address, family: family }] } };
}

async function closedPort() {
  return new Promise(function (resolve) {
    var server = net.createServer();
    server.listen(0, '127.0.0.1', function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

test('TCP diagnostic reports a successful validated connection without exposing IPs', async () => {
  const upstream = await startUpstream();
  const port = new URL(upstream.base).port;
  var captured = [];
  try {
    const result = await diagnoseTcpHost('diag.example.test', port, {
      validationOptions: addressMap(PUBLIC_IP, 4),
      connector: function (details) {
        captured.push(details);
        return net.createConnection({ host: '127.0.0.1', port: Number(port) });
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.connected, true);
    assert.equal(result.addressCount, 1);
    assert.deepEqual(result.addressFamilies, [4]);
    assert.equal(result.attemptsTried, 1);
    assert.equal(result.attempts[0].connectEvent, true);
    assert.equal(result.attempts[0].errorCode || result.attempts[0].socketErrorCode, null);
    assert.equal(result.attempts[0].errorEvent, 'connect');
    assert.equal(captured[0].address.address, PUBLIC_IP,
      'connector must receive the validated public IP');
    assert.ok(!JSON.stringify(result).includes(PUBLIC_IP),
      'API result must not expose the resolved IP');
  } finally {
    await upstream.close();
  }
});

test('TCP diagnostic classifies connection timeout and records no connect event', async () => {
  // A socket that never emits connect exercises the bounded timeout path
  // without depending on external network reachability.
  const result = await diagnoseTcpHost('diag.example.test', 81, {
    validationOptions: addressMap(PUBLIC_IP, 4),
    maxAddressAttempts: 1,
    connectTimeoutMs: 400,
    connectionDeadlineMs: 2000,
    connector: function () { return new net.Socket(); }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CONNECT_TIMEOUT');
  assert.equal(result.errorEvent, 'timeout');
  assert.equal(result.attempts[0].connectEvent, false);
  assert.equal(result.attempts[0].socketErrorCode, 'CONNECT_TIMEOUT');
  assert.ok(result.attempts[0].tcpMs > 0);
});

test('TCP diagnostic classifies refused connections', async () => {
  const port = await closedPort();
  const result = await diagnoseTcpHost('diag.example.test', port, {
    validationOptions: addressMap(PUBLIC_IP, 4),
    maxAddressAttempts: 1,
    connector: function () {
      return net.createConnection({ host: '127.0.0.1', port: port });
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorEvent, 'error');
  assert.equal(result.attempts[0].socketErrorCode, 'ECONNREFUSED');
  assert.equal(result.attempts[0].connectEvent, false);
});

test('TCP diagnostic rejects unreachable hostnames through existing DNS validation', async () => {
  await assert.rejects(function () {
    return diagnoseTcpHost('missing.example.test', 80, {
      validationOptions: { dnsLookup: async function () { return []; } },
      dnsRetries: 0
    });
  }, function (err) {
    return err.code === 'DNS_FAILURE';
  });
});

test('diagnostic endpoint is hidden when disabled', async () => {
  const proxy = await startProxy({ config: { allowTcpDiagnostics: false } });
  try {
    const response = await fetch(proxy.base +
      '/api/diag/tcp?host=diag.example.test&port=80', {
        headers: { DIAGNOSTICS_TOKEN: TOKEN }
      });
    assert.equal(response.status, 404);
  } finally {
    await proxy.close();
  }
});

test('diagnostic endpoint requires a valid token', async () => {
  const proxy = await startProxy({
    config: { allowTcpDiagnostics: true, diagnosticsToken: TOKEN }
  });
  try {
    let response = await fetch(proxy.base +
      '/api/diag/tcp?host=diag.example.test&port=80');
    assert.equal(response.status, 401);

    response = await fetch(proxy.base +
      '/api/diag/tcp?host=diag.example.test&port=80', {
        headers: { DIAGNOSTICS_TOKEN: 'wrong-token' }
      });
    assert.equal(response.status, 401);
  } finally {
    await proxy.close();
  }
});

test('diagnostic endpoint rejects invalid hostnames, ports, and extra parameters', async () => {
  const proxy = await startProxy({
    config: { allowTcpDiagnostics: true, diagnosticsToken: TOKEN }
  });
  try {
    const cases = [
      'host=localhost&port=80',
      'host=example.test%2Fsecret&port=80',
      'host=diag.example.test&port=0',
      'host=diag.example.test&port=70000',
      'host=diag.example.test&port=80&url=http%3A%2F%2Fexample.test%2Fstream'
    ];
    for (const query of cases) {
      const response = await fetch(proxy.base + '/api/diag/tcp?' + query, {
        headers: { DIAGNOSTICS_TOKEN: TOKEN }
      });
      assert.equal(response.status, 400, query);
    }
  } finally {
    await proxy.close();
  }
});

test('diagnostic endpoint cannot be used to probe private addresses', async () => {
  for (const blocked of [{ address: '127.0.0.1', family: 4 },
                         { address: '::127.0.0.1', family: 6 }]) {
    const proxy = await startProxy({
      config: { allowTcpDiagnostics: true, diagnosticsToken: TOKEN },
      tcpDiagnosticsValidationOptions: {
        addressMap: { 'diag.example.test': [blocked] }
      },
      tcpDiagnosticsConnector: function () {
        throw new Error('connector must not run for blocked addresses');
      }
    });
    try {
      const response = await fetch(proxy.base +
        '/api/diag/tcp?host=diag.example.test&port=80', {
          headers: { DIAGNOSTICS_TOKEN: TOKEN }
        });
      assert.equal(response.status, 403, blocked.address);
      const body = await response.json();
      assert.equal(body.error.code, 'BLOCKED_ADDRESS');
    } finally {
      await proxy.close();
    }
  }
});

test('diagnostic endpoint performs a validated TCP probe with host and port only', async () => {
  const upstream = await startUpstream();
  const port = new URL(upstream.base).port;
  const proxy = await startProxy({
    config: { allowTcpDiagnostics: true, diagnosticsToken: TOKEN },
    tcpDiagnosticsValidationOptions: addressMap(PUBLIC_IP, 4),
    tcpDiagnosticsConnector: function () {
      return net.createConnection({ host: '127.0.0.1', port: Number(port) });
    }
  });
  try {
    const response = await fetch(proxy.base +
      '/api/diag/tcp?host=diag.example.test&port=' + port, {
        headers: { DIAGNOSTICS_TOKEN: TOKEN }
      });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.connected, true);
    assert.equal(body.errorCode, null);
    assert.equal(body.attempts[0].connectEvent, true);
    assert.ok(!JSON.stringify(body).includes(PUBLIC_IP));
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
