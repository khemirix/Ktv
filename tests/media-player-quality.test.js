'use strict';

// Automated checks for MediaPlayer network detection, quality selection,
// platform playback paths, and bounded HLS error recovery.
// Run with: node tests/media-player-quality.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'media-player.js'), 'utf8');

function loadMediaPlayer(options) {
  options = options || {};
  let now = 0;
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    window: {
      location: { href: 'https://site.example/index.html' },
      Hls: options.Hls
    },
    document: { baseURI: 'https://site.example/index.html' },
    performance: { now: () => now },
    fetch: options.fetch,
    AbortController,
    URL,
    setTimeout,
    clearTimeout
  };
  if (Object.prototype.hasOwnProperty.call(options, 'navigator')) {
    sandbox.navigator = options.navigator;
  }
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'media-player.js' });
  return { mp: sandbox.MediaPlayer, clock: { advance: (ms) => { now += ms; } } };
}

function makeVideo(options) {
  options = options || {};
  const handlers = {};
  const video = {
    src: '',
    currentTime: options.currentTime || 0,
    error: options.error || null,
    playCount: 0,
    canPlayType(type) {
      return options.nativeHls && /mpegurl/i.test(type) ? 'maybe' : '';
    },
    addEventListener(type, fn) {
      (handlers[type] || (handlers[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      handlers[type] = (handlers[type] || []).filter((h) => h !== fn);
    },
    play() {
      video.playCount += 1;
      return Promise.resolve();
    },
    pause() {},
    load() {},
    removeAttribute(name) {
      if (name === 'src') video.src = '';
    },
    emit(type, data) {
      (handlers[type] || []).forEach((fn) => fn(data));
    }
  };
  return video;
}

function makeHlsClass() {
  function Hls() {
    this.handlers = {};
    this.calls = { startLoad: 0, recoverMediaError: 0, destroy: 0 };
    Hls.instances.push(this);
  }
  Hls.instances = [];
  Hls.isSupported = () => true;
  Hls.Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
  Hls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  Hls.prototype.on = function (name, fn) {
    (this.handlers[name] || (this.handlers[name] = [])).push(fn);
  };
  Hls.prototype.emit = function (name, event, data) {
    var payload = (data === undefined) ? event : data;
    (this.handlers[name] || []).forEach((fn) => fn(event, payload));
  };
  Hls.prototype.loadSource = function (url) { this.url = url; };
  Hls.prototype.attachMedia = function (video) { this.video = video; };
  Hls.prototype.destroy = function () { this.calls.destroy += 1; };
  Hls.prototype.startLoad = function () { this.calls.startLoad += 1; };
  Hls.prototype.recoverMediaError = function () { this.calls.recoverMediaError += 1; };
  return Hls;
}

const CHECKS = [];
function check(name, fn) { CHECKS.push({ name, fn }); }

// ── Network tiers ───────────────────────────────────────────────────
check('slow-2g -> low', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: 'slow-2g' } } });
  assert.strictEqual(mp.networkTier(), 'low');
});

check('2g -> low', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '2g' } } });
  assert.strictEqual(mp.networkTier(), 'low');
});

check('saveData always wins over high downlink', () => {
  const { mp } = loadMediaPlayer({
    navigator: { connection: { effectiveType: '4g', downlink: 20, saveData: true } }
  });
  assert.strictEqual(mp.networkTier(), 'low');
});

check('3g -> medium', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '3g' } } });
  assert.strictEqual(mp.networkTier(), 'medium');
});

check('4g with low downlink -> low (downlink has priority)', () => {
  const { mp } = loadMediaPlayer({
    navigator: { connection: { effectiveType: '4g', downlink: 0.8 } }
  });
  assert.strictEqual(mp.networkTier(), 'low');
});

check('4g with high downlink -> high', () => {
  const { mp } = loadMediaPlayer({
    navigator: { connection: { effectiveType: '4g', downlink: 10 } }
  });
  assert.strictEqual(mp.networkTier(), 'high');
});

check('conflicting 3g label with 15 Mbps downlink -> high (downlink wins)', () => {
  const { mp } = loadMediaPlayer({
    navigator: { connection: { effectiveType: '3g', downlink: 15 } }
  });
  assert.strictEqual(mp.networkTier(), 'high');
});

check('4g label without measured downlink -> medium', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '4g' } } });
  assert.strictEqual(mp.networkTier(), 'medium');
});

check('no Network Information API -> unknown', () => {
  const { mp } = loadMediaPlayer({ navigator: { userAgent: 'iOS' } });
  assert.strictEqual(mp.networkTier(), 'unknown');
});

// ── Lightweight probe for iOS Safari ────────────────────────────────
function probeFetch(bytes, delayMs) {
  return function () {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          headers: { get: () => String(bytes) },
          arrayBuffer: () => Promise.resolve({ byteLength: bytes })
        });
      }, 0);
    }).then((res) => {
      if (delayMs) {
        // Callers that need a measured delay advance the fake clock themselves.
      }
      return res;
    });
  };
}

check('probe: fast small asset -> high', async () => {
  const ctx = loadMediaPlayer({ navigator: { userAgent: 'iOS' }, fetch: probeFetch(200000) });
  const pending = ctx.mp.estimateNetworkTier();
  ctx.clock.advance(20);
  assert.strictEqual((await pending), 'high');
});

check('probe: slow small asset -> low', async () => {
  const ctx = loadMediaPlayer({ navigator: { userAgent: 'iOS' }, fetch: probeFetch(100000) });
  const pending = ctx.mp.estimateNetworkTier();
  ctx.clock.advance(1000);
  assert.strictEqual((await pending), 'low');
});

check('probe: failed fetch -> conservative unknown', async () => {
  const { mp } = loadMediaPlayer({
    navigator: { userAgent: 'iOS' },
    fetch: () => Promise.reject(new Error('offline'))
  });
  assert.strictEqual((await mp.estimateNetworkTier()), 'unknown');
});

// ── Quality selection independent of API order ──────────────────────
const LINKS = [
  { quality: '720p', url: 'https://hls.example/720.m3u8' },
  { quality: 'ORG', url: 'https://cdn.example/original.mp4' },
  { quality: '360p', url: 'https://hls.example/360.m3u8' },
  { quality: '1080p', url: 'https://hls.example/1080.m3u8' }
];

check('low tier selects lowest label regardless of array position', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '2g' } } });
  assert.strictEqual(mp.chooseDefault(LINKS, 'low'), 2);
});

check('medium tier selects best up to 720p regardless of array position', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '3g' } } });
  assert.strictEqual(mp.chooseDefault(LINKS, 'medium'), 0);
});

check('high tier selects highest label, not links[0]', () => {
  const { mp } = loadMediaPlayer({ navigator: { connection: { effectiveType: '4g', downlink: 10 } } });
  assert.strictEqual(mp.chooseDefault(LINKS, 'high'), 1);
});

check('unknown tier stays conservative', () => {
  const { mp } = loadMediaPlayer({ navigator: { userAgent: 'iOS' } });
  assert.strictEqual(mp.chooseDefault(LINKS, 'unknown'), 0);
});

check('missing quality labels are ignored but safe', () => {
  const { mp } = loadMediaPlayer({});
  const partial = [
    { url: 'https://cdn.example/unknown.mp4' },
    { quality: '360p', url: 'https://hls.example/360.m3u8' }
  ];
  assert.strictEqual(mp.chooseDefault(partial, 'low'), 1);
  assert.strictEqual(mp.chooseDefault([{ url: 'https://cdn.example/only.mp4' }], 'low'), 0);
  assert.strictEqual(mp.chooseDefault([], 'low'), 0);
});

check('only one available quality', () => {
  const { mp } = loadMediaPlayer({});
  const one = [{ quality: '480p', url: 'https://hls.example/480.m3u8' }];
  ['low', 'medium', 'high', 'unknown'].forEach((tier) => {
    assert.strictEqual(mp.chooseDefault(one, tier), 0);
  });
});

check('4K and 2160p rank equally', () => {
  const { mp } = loadMediaPlayer({});
  assert.strictEqual(mp.qualityRank({ quality: '4K' }), 2160);
  assert.strictEqual(mp.qualityRank({ quality: '2160p' }), 2160);
  assert.strictEqual(mp.qualityRank({ quality: 'ORG' }), Infinity);
  assert.strictEqual(mp.qualityRank({}), null);
});

check('direct fallback follows the selected tier', () => {
  const { mp } = loadMediaPlayer({});
  const direct = [
    { quality: 'ORG', url: 'https://cdn.example/org.mp4' },
    { quality: '360p', url: 'https://cdn.example/360.mp4' }
  ];
  assert.strictEqual(mp.fallbackFor(direct, 'low'), direct[1].url);
  assert.strictEqual(mp.fallbackFor(direct, 'high'), direct[0].url);
});

// ── Platform playback paths ─────────────────────────────────────────
check('native HLS is used when the browser supports it', () => {
  const Hls = makeHlsClass();
  const { mp } = loadMediaPlayer({ Hls });
  const video = makeVideo({ nativeHls: true });
  const player = mp.create(video, {});
  player.load('https://hls.example/720.m3u8', {});
  assert.strictEqual(player.kind(), 'native-hls');
  assert.strictEqual(video.src, 'https://hls.example/720.m3u8');
  assert.strictEqual(Hls.instances.length, 0);
  player.destroy();
});

check('HLS.js initializes and only marks playing after manifest parsed', () => {
  const Hls = makeHlsClass();
  const { mp } = loadMediaPlayer({ Hls });
  const video = makeVideo({ nativeHls: false });
  const events = [];
  const player = mp.create(video, {
    onStatus: (kind) => events.push(kind),
    onPlaying: (info) => events.push('playing:' + info.kind)
  });
  player.load('https://hls.example/720.m3u8', {});
  assert.strictEqual(player.kind(), 'hls.js');
  assert.strictEqual(Hls.instances.length, 1);
  assert.strictEqual(Hls.instances[0].url, 'https://hls.example/720.m3u8');
  assert.deepStrictEqual(events, ['hls.js']);
  Hls.instances[0].emit(Hls.Events.MANIFEST_PARSED, {});
  assert.strictEqual(video.playCount, 1);
  video.emit('playing');
  assert.deepStrictEqual(events, ['hls.js', 'playing:hls.js']);
  player.destroy();
});

check('HLS.js unavailable falls back to direct MP4 with a useful warning', () => {
  const Hls = makeHlsClass();
  Hls.isSupported = () => false;
  const { mp } = loadMediaPlayer({ Hls });
  const video = makeVideo({ nativeHls: false });
  const warnings = [];
  const playing = [];
  const player = mp.create(video, {
    onError: (message, fatal) => warnings.push({ message, fatal }),
    onPlaying: (info) => playing.push(info)
  });
  player.load('https://hls.example/720.m3u8', {
    fallbackUrl: 'https://cdn.example/original.mp4'
  });
  assert.strictEqual(video.src, 'https://cdn.example/original.mp4');
  assert.match(warnings[0].message, /HLS\.js is unavailable/);
  assert.strictEqual(warnings[0].fatal, false);
  video.emit('playing');
  assert.strictEqual(playing[0].url, 'https://cdn.example/original.mp4');
  player.destroy();
});

check('fatal HLS manifest failure retries twice then falls back once', () => {
  const Hls = makeHlsClass();
  const { mp } = loadMediaPlayer({ Hls });
  const video = makeVideo({ nativeHls: false });
  const messages = [];
  const player = mp.create(video, {
    onError: (message) => messages.push(message)
  });
  player.load('https://hls.example/720.m3u8', {
    fallbackUrl: 'https://cdn.example/original.mp4'
  });
  const hls = Hls.instances[0];
  const fatal = {
    fatal: true,
    type: Hls.ErrorTypes.NETWORK_ERROR,
    details: 'manifestLoadError'
  };
  hls.emit(Hls.Events.ERROR, {}, fatal);
  hls.emit(Hls.Events.ERROR, {}, fatal);
  assert.strictEqual(hls.calls.startLoad, 2);
  assert.strictEqual(video.src, '');
  hls.emit(Hls.Events.ERROR, {}, fatal);
  assert.strictEqual(video.src, 'https://cdn.example/original.mp4');
  assert.strictEqual(hls.calls.destroy, 1);
  assert.ok(messages.some((m) => /Unable to play this HLS stream/.test(m)));
  // A late duplicate error must not loop into another fallback.
  hls.emit(Hls.Events.ERROR, {}, fatal);
  assert.strictEqual(video.src, 'https://cdn.example/original.mp4');
  player.destroy();
});

check('fatal HLS segment failure is handled as a network error', () => {
  const Hls = makeHlsClass();
  const { mp } = loadMediaPlayer({ Hls });
  const video = makeVideo({ nativeHls: false });
  const player = mp.create(video, {});
  player.load('https://hls.example/360.m3u8', {
    fallbackUrl: 'https://cdn.example/original.mp4'
  });
  const hls = Hls.instances[0];
  hls.emit(Hls.Events.ERROR, {}, {
    fatal: true,
    type: Hls.ErrorTypes.NETWORK_ERROR,
    details: 'fragLoadError'
  });
  assert.strictEqual(hls.calls.startLoad, 1);
  player.destroy();
});

check('direct MP4 quality switch preserves playback position', () => {
  const { mp } = loadMediaPlayer({});
  const video = makeVideo({ currentTime: 42 });
  const player = mp.create(video, {});
  player.load('https://cdn.example/first.mp4', {});
  player.load('https://cdn.example/second.mp4', {});
  video.emit('loadedmetadata');
  assert.strictEqual(video.currentTime, 42);
  player.destroy();
});

async function main() {
  for (const item of CHECKS) {
    await item.fn();
    console.log('PASS ' + item.name);
  }
  console.log('media-player quality tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
