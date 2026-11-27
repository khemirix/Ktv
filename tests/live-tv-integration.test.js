'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PRIMARY = 'https://ktv-nu.vercel.app';
const FALLBACK = 'https://ktv-86d0f.containers.snapdeploy.app';
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

test('proxy URLs are centralized in one frontend source file', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(name => name.endsWith('.js'));
  for (const url of [PRIMARY, FALLBACK]) {
    const matches = files.filter(name => read(path.join('js', name)).includes(url));
    assert.deepEqual(matches, ['smart-proxy-config.js'], url + ' must only live in config');
  }
});

test('config pins Vercel primary and SnapDeploy fallback exactly', () => {
  const config = read('js/smart-proxy-config.js');
  assert.match(config, /DEFAULT_PROXY_URL = 'https:\/\/ktv-nu\.vercel\.app'/);
  assert.match(config, /FALLBACK_PROXY_URL = 'https:\/\/ktv-86d0f\.containers\.snapdeploy\.app'/);
  assert.doesNotMatch(config, /onrender\.com|old-render-host/i);
  assert.match(config, /localStorage[\s\S]*deliberately ignored/i);
});

test('Live TV detects and verifies failover through the client', () => {
  const tv = read('tv.html');
  assert.match(tv, /function proxyFallback\(\)/);
  assert.match(tv, /proxyFallback\(\)/);
  assert.match(tv, /KTV_SMART_PROXY_FAILOVER_ALLOWED === true/);
  assert.match(tv, /fallbackBaseUrl:/);
  assert.match(tv, /allowFallback:/);
  assert.match(tv, /detected\.baseUrl === proxyBase\(\)/);
  assert.match(tv, /forceFallback:\s*true/);
});

test('every active Live TV HTML page loads the central config', () => {
  const htmlFiles = [
    'index.html', 'index1.html', 'movie-test.html', 'player.html',
    'player/player.html', 'tv.html'
  ];
  for (const file of htmlFiles) {
    const source = read(file);
    const initializesLiveTv = /LivePlayer\.play|tvVideo/.test(source);
    if (initializesLiveTv) {
      assert.match(source, /js\/smart-proxy-config\.js/,
        file + ' must load the single proxy config');
      assert.match(source, /js\/smart-proxy-client\.js/,
        file + ' must load the failover-capable client');
    }
  }
});

test('no active Live TV runtime file contains a Render proxy URL', () => {
  for (const file of [
    'tv.html',
    'js/smart-proxy-config.js',
    'js/smart-proxy-client.js',
    'js/live-player.js',
    'js/stream-detector.js'
  ]) {
    assert.doesNotMatch(read(file), /onrender\.com|old-render-host|t-ahg3/i,
      file + ' must not contain a Render proxy URL');
  }
});

test('Live TV has four HLS quality preferences and disables them for single-quality streams', () => {
  const tv = read('tv.html');
  assert.match(tv, /id="liveQuality"/);
  assert.match(tv, />Auto</);
  assert.match(tv, />Data Saver</);
  assert.match(tv, />Balanced</);
  assert.match(tv, />Best</);
  assert.match(tv, /quality:\s*liveQualityMode/);
  assert.match(tv, /qualitySelect\.disabled = !hlsStream/);
  assert.match(tv, /setQuality\(liveQualityMode\)/);
  assert.doesNotMatch(read('index.html'), /id="liveQuality"/,
    'the Movies player must not gain Live TV quality controls');
});

test('Live TV reconnect path is generation-aware and refreshes live content', () => {
  const tv = read('tv.html');
  const player = read('js/live-player.js');
  assert.match(tv, /onReconnect:\s*function/);
  assert.match(tv, /playGen !== playGeneration/);
  assert.match(tv, /reconnectCurrentStream/);
  assert.match(player, /recoveryGeneration/);
  assert.match(player, /requestFullReconnect/);
  assert.match(player, /seekLiveEdge/);
  assert.match(player, /stopWatchdog/);
  assert.match(player, /video\.paused/);
});

test('Live TV playback adapter exposes runtime quality changes', () => {
  const player = require(path.join(ROOT, 'js/live-player.js'));
  const instance = player.play({
    video: {
      addEventListener() {}, removeEventListener() {}, play() { return Promise.resolve(); },
      pause() {}, load() {}, removeAttribute() {}, buffered: { length: 0 },
      currentTime: 0, readyState: 0, canPlayType() { return 'probably'; }
    },
    engine: 'native', format: 'mp4', url: 'http://x/a.mp4',
    Hls: null, mpegts: null, handlers: {}
  });
  assert.equal(instance.setQuality('best'), 'best');
  assert.equal(instance.quality(), 'best');
  instance.destroy();
});

test('StreamDetector builds Smart Proxy playback URLs', () => {
  const detector = require(path.join(ROOT, 'js/stream-detector.js'));
  const url = detector.proxyUrl('https://proxy.example/', 'http://stream.test/live?token=abc');
  assert.match(url, /^https:\/\/proxy\.example\/api\/stream\?url=/);
  assert.match(url, /token%3Dabc/);
});
