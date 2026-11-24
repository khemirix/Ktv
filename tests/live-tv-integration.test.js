'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('Live TV has no legacy proxy endpoint or outdated Render PROXY variable', () => {
  const tv = read('tv.html');
  const detector = read('js/stream-detector.js');

  assert.ok(!/var\s+PROXY\s*=/.test(tv), 'legacy PROXY variable must be removed');
  assert.ok(!/\/fetch\?url=/.test(tv), 'tv.html must not use legacy /fetch');
  assert.ok(!/\/fetch\?url=/.test(detector), 'StreamDetector must use /api/stream');
  assert.ok(/smart-proxy-config\.js/.test(tv));
  assert.ok(/smart-proxy-client\.js/.test(tv));
});

test('Live TV blocks direct HTTP media on HTTPS pages', () => {
  const tv = read('tv.html');
  assert.match(tv, /streamRequiresProxy/);
  assert.match(tv, /location\.protocol === 'https:'/);
  assert.match(tv, /tryDirect:\s*true/);
  assert.match(tv, /proxy:\s*''/);
  assert.match(tv, /retries:\s*1/);
  assert.doesNotMatch(tv, /tryDirect:\s*false/);
});

test('proxy URL is centralized in one frontend source file', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(name => name.endsWith('.js'));
  const matches = files.filter(name => {
    return read(path.join('js', name)).includes('https://ktv-edmu.onrender.com');
  });
  assert.deepEqual(matches, ['smart-proxy-config.js']);
});

test('StreamDetector builds Smart Proxy playback URLs', () => {
  const detector = require(path.join(ROOT, 'js/stream-detector.js'));
  const url = detector.proxyUrl('https://proxy.example/', 'http://stream.test/live?token=abc');
  assert.match(url, /^https:\/\/proxy\.example\/api\/stream\?url=/);
  assert.match(url, /token%3Dabc/);
});
