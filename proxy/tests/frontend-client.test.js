'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CLIENT = path.resolve(__dirname, '../../js/smart-proxy-client.js');
const PRIMARY = 'https://ktv-nu.vercel.app';
const FALLBACK = 'https://ktv-86d0f.containers.snapdeploy.app';

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

function jsonResponse(body, status) {
  const code = status || 200;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => body
  };
}

function streamResponse(status, contentType, options) {
  const code = status || 200;
  const opts = options || {};
  const response = {
    ok: code >= 200 && code < 300,
    status: code,
    headers: {
      get: name => name.toLowerCase() === 'content-type'
        ? (contentType || 'video/mp2t') : null
    }
  };
  if (opts.noBody) return response;
  response.body = {
    getReader() {
      return {
        async read() {
          return opts.empty ? { done: true, value: undefined }
            : { done: false, value: new Uint8Array([0x47]) };
        },
        async cancel() {}
      };
    },
    async cancel() {}
  };
  return response;
}

function detectedBody(base) {
  return {
    ok: true,
    format: 'mpegts',
    engine: 'mpegts.js',
    playbackUrl: base + '/api/stream?url=abc',
    confidence: 'high',
    reason: 'content signature',
    proxyStreamingSupported: true,
    diagnostics: []
  };
}

test('frontend client is disabled without a configured base URL', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
  assert.equal(client.isEnabled(''), false);
  assert.equal(client.isEnabled('https://proxy.example/'), true);
  assert.equal(await client.detect('http://example.test/live'), null);
  assert.deepEqual(client.candidateBases({ baseUrl: '' }), []);
});

test('frontend client maps detect API output and verifies the real stream endpoint', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
  const previousFetch = global.fetch;
  const calls = [];

  global.fetch = async function (url, init) {
    calls.push({
      url,
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {}
    });
    return url.includes('/api/detect')
      ? jsonResponse(detectedBody('https://proxy.example'))
      : streamResponse(200, 'video/mp2t');
  };

  try {
    const result = await client.detect('http://example.test/live?token=secret', {
      baseUrl: 'https://proxy.example/',
      metadata: { format: 'mpegts' }
    });
    const detectCall = calls.find(call => call.url.includes('/api/detect'));
    const streamCall = calls.find(call => call.url.includes('/api/stream'));

    assert.match(result.mediaUrl, /^https:\/\/proxy\.example\/api\/stream\?url=abc&_cb=/);
    assert.equal(result.engine, 'mpegts.js');
    assert.equal(result.via, 'smart-proxy');
    assert.equal(result.originalUrl, 'http://example.test/live?token=secret');
    assert.match(detectCall.url, /^https:\/\/proxy\.example\/api\/detect\?url=/);
    assert.ok(detectCall.url.includes('token%3Dsecret'));
    assert.ok(detectCall.url.includes('format=mpegts'));
    assert.ok(detectCall.url.includes('_cb='), 'detect request bypasses cached wake pages');
    assert.equal(streamCall.method, 'GET', 'stream endpoint uses the playback method');
    assert.equal(streamCall.headers.Range, 'bytes=0-0',
      'verification reads one byte without buffering the live stream');
    assert.equal(result.failoverUsed, false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('ranged GET verification succeeds when a live upstream rejects HEAD', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url, init) {
    calls.push({ url, method: (init && init.method) || 'GET', headers: (init && init.headers) || {} });
    if (url.includes('/api/detect')) return jsonResponse(detectedBody('https://proxy.example'));
    // Emulate an upstream that answers playback GET with 206 but would reject HEAD.
    return streamResponse(206, 'video/mp2t');
  };

  try {
    const result = await client.detect('http://example.test/live.ts', {
      baseUrl: 'https://proxy.example',
      retries: 0
    });
    const streamCall = calls.find(call => call.url.includes('/api/stream'));
    assert.equal(streamCall.method, 'GET');
    assert.equal(streamCall.headers.Range, 'bytes=0-0');
    assert.equal(result.engine, 'mpegts.js');
    assert.equal(result.failoverUsed, false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('416 from a range-limited upstream does not trigger proxy failover', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    return url.includes('/api/detect')
      ? jsonResponse(detectedBody('https://proxy.example'))
      : streamResponse(416, 'video/mp2t', { empty: true });
  };

  try {
    const result = await client.detect('http://example.test/live.ts', {
      baseUrl: 'https://proxy.example',
      retries: 0
    });
    assert.equal(result.baseUrl, 'https://proxy.example');
    assert.equal(calls.length, 2, 'a range-only 416 must not contact another proxy');
  } finally {
    global.fetch = previousFetch;
  }
});

test('frontend client surfaces safe proxy errors without failing over for stream-level blocks', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: PRIMARY, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    return jsonResponse({
      ok: false,
      error: { code: 'BLOCKED_ADDRESS', message: 'The stream host is not allowed.' }
    }, 403);
  };

  try {
    await assert.rejects(
      client.detect('http://example.test/live', {
        baseUrl: PRIMARY,
        fallbackBaseUrl: FALLBACK,
        allowFallback: true,
        retries: 0
      }),
      err => err.code === 'BLOCKED_ADDRESS' &&
        err.message === 'The proxy blocked this stream address for safety.'
    );
    assert.equal(calls.length, 1, 'stream-specific 403 must not trigger fallback');
    assert.ok(calls[0].startsWith(PRIMARY));
  } finally {
    global.fetch = previousFetch;
  }
});

test('frontend client links an external abort signal so channel switches cancel requests', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
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

test('frontend client retries temporary upstream failures on the same proxy', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: '' });
  const previousFetch = global.fetch;
  const calls = [];
  let detects = 0;

  global.fetch = async function (url) {
    calls.push(url);
    if (url.includes('/api/detect')) {
      detects += 1;
      if (detects === 1) {
        return jsonResponse({
          ok: false,
          error: { code: 'UPSTREAM_TIMEOUT', message: 'The upstream stream did not respond in time.' }
        }, 504);
      }
      return jsonResponse(detectedBody('https://proxy.example'));
    }
    return streamResponse();
  };

  try {
    const result = await client.detect('http://example.test/live.m3u8', {
      baseUrl: 'https://proxy.example',
      retries: 1
    });
    assert.equal(detects, 2);
    assert.equal(result.engine, 'mpegts.js');
    assert.equal(result.failoverUsed, false);
    assert.ok(calls.every(url => url.startsWith('https://proxy.example')));
  } finally {
    global.fetch = previousFetch;
  }
});

test('Vercel is tried first and SnapDeploy is not contacted on a valid stream', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: PRIMARY, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    return url.includes('/api/detect')
      ? jsonResponse(detectedBody(PRIMARY))
      : streamResponse(200, 'video/mp2t');
  };

  try {
    const result = await client.detect('http://example.test/live', {
      baseUrl: PRIMARY,
      fallbackBaseUrl: FALLBACK,
      allowFallback: true,
      retries: 0
    });
    assert.equal(result.baseUrl, PRIMARY);
    assert.equal(result.failoverUsed, false);
    assert.ok(calls.length === 2, 'only detect + stream verification are expected');
    assert.ok(calls.every(url => url.startsWith(PRIMARY)),
      'a valid Vercel stream must never contact SnapDeploy');
  } finally {
    global.fetch = previousFetch;
  }
});

test('detect failure on Vercel automatically retries through SnapDeploy', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: PRIMARY, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    if (url.includes('/api/detect')) {
      if (url.startsWith(PRIMARY)) return jsonResponse({ ok: false }, 503);
      return jsonResponse(detectedBody(FALLBACK));
    }
    return streamResponse(200, 'video/mp2t');
  };

  try {
    const result = await client.detect('http://example.test/live', {
      baseUrl: PRIMARY,
      fallbackBaseUrl: FALLBACK,
      allowFallback: true,
      retries: 0
    });
    assert.equal(result.baseUrl, FALLBACK);
    assert.equal(result.failoverUsed, true);
    assert.ok(result.warnings.some(warning => /backup proxy/i.test(warning)));
    assert.ok(calls.some(url => url.startsWith(PRIMARY) && url.includes('/api/detect')));
    assert.ok(calls.some(url => url.startsWith(FALLBACK) && url.includes('/api/detect')));
    assert.ok(calls.some(url => url.startsWith(FALLBACK) && url.includes('/api/stream')));
  } finally {
    global.fetch = previousFetch;
  }
});

test('failed /api/stream verification on Vercel triggers SnapDeploy once', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: PRIMARY, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    const isDetect = url.includes('/api/detect');
    if (url.startsWith(PRIMARY)) {
      return isDetect
        ? jsonResponse(detectedBody(PRIMARY))
        : streamResponse(503, 'text/html; charset=utf-8');
    }
    return isDetect
      ? jsonResponse(detectedBody(FALLBACK))
      : streamResponse(200, 'video/mp2t');
  };

  try {
    const result = await client.detect('http://example.test/live', {
      baseUrl: PRIMARY,
      fallbackBaseUrl: FALLBACK,
      allowFallback: true,
      retries: 0
    });
    assert.equal(result.baseUrl, FALLBACK);
    assert.equal(result.failoverUsed, true);
    assert.equal(calls.filter(url => url.includes('/api/detect')).length, 2);
    assert.equal(calls.filter(url => url.includes('/api/stream')).length, 2);
    assert.ok(calls.every(url => url.startsWith(PRIMARY) || url.startsWith(FALLBACK)));
  } finally {
    global.fetch = previousFetch;
  }
});

test('invalid proxy response also fails over, and both failures produce a useful error', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: PRIMARY, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async function () {
    calls += 1;
    return calls === 1
      ? jsonResponse({ ok: true, format: 'mpegts' })
      : jsonResponse({ ok: false }, 503);
  };

  try {
    await assert.rejects(
      client.detect('http://example.test/live', {
        baseUrl: PRIMARY,
        fallbackBaseUrl: FALLBACK,
        allowFallback: true,
        retries: 0
      }),
      err => err.code === 'PROXY_UNAVAILABLE' &&
        /Backup proxy also failed/i.test(err.message) &&
        err.triedBases.length === 2
    );
    assert.equal(calls, 2, 'no third proxy or repeated alternation');
  } finally {
    global.fetch = previousFetch;
  }
});

test('explicit SnapDeploy selection never tries Vercel', async () => {
  const client = loadClient({ KTV_SMART_PROXY_URL: FALLBACK, KTV_SMART_PROXY_FALLBACK: FALLBACK });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async function (url) {
    calls.push(url);
    return jsonResponse({ ok: false }, 503);
  };

  try {
    await assert.rejects(
      client.detect('http://example.test/live', {
        baseUrl: FALLBACK,
        fallbackBaseUrl: FALLBACK,
        allowFallback: false,
        retries: 0
      }),
      err => err.code === 'PROXY_UNAVAILABLE'
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(FALLBACK));
  } finally {
    global.fetch = previousFetch;
  }
});
