'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '../../js/smart-proxy-config.js');
const PRIMARY = 'https://ktv-nu.vercel.app';
const FALLBACK = 'https://ktv-86d0f.containers.snapdeploy.app';

function loadConfig(win) {
  const previous = global.window;
  global.window = win;
  delete require.cache[require.resolve(CONFIG)];
  require(CONFIG);
  global.window = previous;
  delete require.cache[require.resolve(CONFIG)];
  return win;
}

test('central config pins Vercel as the only default proxy', () => {
  const loaded = loadConfig({ location: { search: '' }, localStorage: null });
  assert.equal(loaded.KTV_SMART_PROXY_URL, PRIMARY);
  assert.equal(loaded.KTV_SMART_PROXY_DEFAULT, PRIMARY);
  assert.equal(loaded.KTV_SMART_PROXY_FALLBACK, FALLBACK);
  assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'default');
  assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'default');
  assert.equal(loaded.KTV_SMART_PROXY_FAILOVER_ALLOWED, true);
  assert.notEqual(loaded.KTV_SMART_PROXY_URL, loaded.KTV_SMART_PROXY_FALLBACK);
});

test('explicit aliases select the correct proxy without changing the default', () => {
  let loaded = loadConfig({
    location: { search: '?proxy=vercel' },
    localStorage: null
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, PRIMARY);
  assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'vercel');
  assert.equal(loaded.KTV_SMART_PROXY_FAILOVER_ALLOWED, true);

  loaded = loadConfig({
    location: { search: '?proxy=snapdeploy' },
    localStorage: null
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, FALLBACK);
  assert.equal(loaded.KTV_SMART_PROXY_DEFAULT, PRIMARY);
  assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'snapdeploy');
  assert.equal(loaded.KTV_SMART_PROXY_FAILOVER_ALLOWED, false);
});

test('custom URL is explicit only; off disables proxy', () => {
  let loaded = loadConfig({
    location: { search: '?proxy=https://override.example/' },
    localStorage: null
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, 'https://override.example');
  assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'custom');
  assert.equal(loaded.KTV_SMART_PROXY_FAILOVER_ALLOWED, false);

  loaded = loadConfig({
    location: { search: '?proxy=off' },
    localStorage: { getItem: () => FALLBACK }
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, '');
  assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'off');
  assert.equal(loaded.KTV_SMART_PROXY_FAILOVER_ALLOWED, false);
});

test('old localStorage values cannot override Vercel primary', () => {
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const stored of [
      FALLBACK,
      PRIMARY,
      'https://old-render-host.example',
      'https://old-custom.example'
    ]) {
      const loaded = loadConfig({
        location: { search: '' },
        localStorage: { getItem: () => stored }
      });
      assert.equal(loaded.KTV_SMART_PROXY_URL, PRIMARY);
      assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'default');
      assert.equal(loaded.KTV_SMART_PROXY_SELECTION, 'default');
      assert.ok(!warnings.join(' ').includes(stored), 'stored URL must not be logged');
    }
  } finally {
    console.warn = previousWarn;
  }
});

test('config contains no Render URL', () => {
  const source = require('node:fs').readFileSync(CONFIG, 'utf8');
  assert.ok(!/onrender\.com/i.test(source));
  assert.ok(!/old-render-host/i.test(source));
});
