'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startProxy, json } = require('./helpers');

test('GET /health reports status, version, and uptime', async () => {
  const proxy = await startProxy();
  try {
    const result = await json(proxy.base + '/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'ok');
    assert.equal(result.body.service, 'khemirix-smart-proxy');
    assert.ok(result.body.version);
    assert.ok(typeof result.body.uptimeSeconds === 'number');
    assert.ok(result.body.activeStreams >= 0);
  } finally {
    await proxy.close();
  }
});
