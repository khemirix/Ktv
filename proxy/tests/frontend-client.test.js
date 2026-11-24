'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CLIENT = path.resolve(__dirname, '../../js/smart-proxy-client.js');

function loadClient(win) {
  const previousWindow = global.window;
  global.window = win;
  delete require.cache[require.resolve(CLIENT)];
  require(CLIENT);
  const client = win.SmartProxyClient;
  global.window = previousWindow;
  delete require.cache[require.resolve(CLIENT)];
  return client;
}

test('frontend client is disabled without a configured base URL', async () => {
  const win = { KTV_SMART_PROXY_URL: '' };
  const client = loadClient(win);
  assert.equal(client.isEnabled(''), false);
  assert.equal(client.isEnabled('https://proxy.example/'), true);
  assert.equal(await client.detect('http://example.test/live'), null);
});

test('frontend client maps detect API output into LivePlayer shape', async () => {
  const win = { KTV_SMART_PROXY_URL: '' };
  const client = loadClient(win);
  const previousFetch = global.fetch;
  let requestedUrl = '';

  global.fetch = async function (url) {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        format: 'mpegts',
        engine: 'mpegts.js',
        playbackUrl: 'https://proxy.example/api/stream?url=abc',
        confidence: 'high',
        reason: 'content signature',
        proxyStreamingSupported: true,
        diagnostics: []
      })
    };
  };

  try {
    const result = await client.detect('http://example.test/live?token=secret', {
      baseUrl: 'https://proxy.example/',
      metadata: { format: 'mpegts' }
    });
    assert.equal(result.mediaUrl, 'https://proxy.example/api/stream?url=abc');
    assert.equal(result.engine, 'mpegts.js');
    assert.equal(result.via, 'smart-proxy');
    assert.equal(result.originalUrl, 'http://example.test/live?token=secret');
    assert.match(requestedUrl, /^https:\/\/proxy\.example\/api\/detect\?url=/);
    assert.ok(requestedUrl.includes('token%3Dsecret'));
    assert.ok(requestedUrl.includes('format=mpegts'));
  } finally {
    global.fetch = previousFetch;
  }
});

test('frontend client surfaces safe proxy errors', async () => {
  const win = { KTV_SMART_PROXY_URL: '' };
  const client = loadClient(win);
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      ok: false,
      error: { code: 'BLOCKED_ADDRESS', message: 'The stream host is not allowed.' }
    })
  });

  try {
    await assert.rejects(
      client.detect('http://example.test/live', { baseUrl: 'https://proxy.example' }),
      err => err.code === 'BLOCKED_ADDRESS' &&
        err.message === 'The proxy blocked this stream address for safety.');
  } finally {
    global.fetch = previousFetch;
  }
});

test('frontend client links an external abort signal so channel switches cancel requests', async () => {
  const win = { KTV_SMART_PROXY_URL: '' };
  const client = loadClient(win);
  const previousFetch = global.fetch;
  const controller = new AbortController();
  let usedSignal = null;

  global.fetch = async function (url, init) {
    usedSignal = init.signal;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  try {
    const pending = client.detect('http://example.test/live.m3u8', {
      baseUrl: 'https://proxy.example',
      signal: controller.signal
    });
    controller.abort();
    await assert.rejects(pending, err => err.code === 'CLIENT_CLOSED');
    assert.ok(usedSignal && usedSignal.aborted,
      'the fetch signal must be aborted with the channel controller');
  } finally {
    global.fetch = previousFetch;
  }
});

test('frontend client retries temporary upstream failures once', async () => {
  const win = { KTV_SMART_PROXY_URL: '' };
  const client = loadClient(win);
  const previousFetch = global.fetch;
  let calls = 0;

  global.fetch = async function () {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 504,
        json: async () => ({
          ok: false,
          error: { code: 'UPSTREAM_TIMEOUT', message: 'The upstream stream did not respond in time.' }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        format: 'hls',
        engine: 'hls.js',
        playbackUrl: 'https://proxy.example/api/stream?url=abc',
        confidence: 'high',
        reason: 'content signature',
        proxyStreamingSupported: true,
        diagnostics: []
      })
    };
  };

  try {
    const result = await client.detect('http://example.test/live.m3u8', {
      baseUrl: 'https://proxy.example',
      retries: 1
    });
    assert.equal(calls, 2);
    assert.equal(result.engine, 'hls.js');
  } finally {
    global.fetch = previousFetch;
  }
});

