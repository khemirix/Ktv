'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '../../js/smart-proxy-config.js');

function loadConfig(win) {
  const previous = global.window;
  global.window = win;
  delete require.cache[require.resolve(CONFIG)];
  require(CONFIG);
  global.window = previous;
  delete require.cache[require.resolve(CONFIG)];
  return win;
}

test('central config provides the proxy URL by default', () => {
  const win = { location: { search: '' }, localStorage: null };
  const loaded = loadConfig(win);
  assert.ok(loaded.KTV_SMART_PROXY_URL.startsWith('https://'));
  assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'default');
  assert.equal(loaded.KTV_SMART_PROXY_DEFAULT, loaded.KTV_SMART_PROXY_URL);
});

test('query and storage overrides work, and off disables the proxy', () => {
  let loaded = loadConfig({
    location: { search: '?proxy=https://override.example/' },
    localStorage: null
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, 'https://override.example');
  assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'query');

  loaded = loadConfig({
    location: { search: '' },
    localStorage: { getItem: () => 'https://stored.example' }
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, 'https://stored.example');
  assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'storage');

  loaded = loadConfig({
    location: { search: '?proxy=off' },
    localStorage: { getItem: () => 'https://stored.example' }
  });
  assert.equal(loaded.KTV_SMART_PROXY_URL, '');
  assert.equal(loaded.KTV_SMART_PROXY_SOURCE, 'query');
});
