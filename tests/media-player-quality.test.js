'use strict';

// Focused tests for MediaPlayer network-tier detection and initial quality
// selection. Run with: node tests/media-player-quality.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'media-player.js'),
  'utf8'
);

function loadMediaPlayer(navigatorValue) {
  const sandbox = { console, window: {} };
  if (navigatorValue !== undefined) sandbox.navigator = navigatorValue;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'media-player.js' });
  return sandbox.MediaPlayer;
}

const LINKS = [
  { quality: 'ORG', url: 'https://cdn.example/video.mp4' },
  { quality: '4K', url: 'https://hls.example/4k.m3u8' },
  { quality: '2160p', url: 'https://hls.example/2160.m3u8' },
  { quality: '1080p', url: 'https://hls.example/1080.m3u8' },
  { quality: '720p', url: 'https://hls.example/720.m3u8' },
  { quality: '480p', url: 'https://hls.example/480.m3u8' },
  { quality: '360p', url: 'https://hls.example/360.m3u8' }
];

const INDEX = {
  ORG: 0,
  K4: 1,
  P2160: 2,
  P1080: 3,
  P720: 4,
  P480: 5,
  P360: 6
};

function qualityAt(links, index) {
  return index === 0 ? 'index 0' : links[index].quality;
}

function run(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

// 1. Unavailable Network Information API must be conservative.
run('unavailable API (navigator missing) -> balanced 720p', () => {
  const mp = loadMediaPlayer(undefined);
  assert.strictEqual(mp.networkTier(), 'unknown');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P720);
});

run('unavailable connection object -> balanced 720p', () => {
  const mp = loadMediaPlayer({ userAgent: 'test' });
  assert.strictEqual(mp.networkTier(), 'unknown');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P720);
});

// 2. Conflicting hints: the most conservative signal wins.
run('4g with 0.8 Mbps downlink -> low (360p)', () => {
  const mp = loadMediaPlayer({ connection: { effectiveType: '4g', downlink: 0.8 } });
  assert.strictEqual(mp.networkTier(), 'low');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P360);
});

run('3g with 15 Mbps downlink -> medium (720p)', () => {
  const mp = loadMediaPlayer({ connection: { effectiveType: '3g', downlink: 15 } });
  assert.strictEqual(mp.networkTier(), 'medium');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P720);
});

run('saveData with high downlink -> low (360p)', () => {
  const mp = loadMediaPlayer({
    connection: { effectiveType: '4g', downlink: 20, saveData: true }
  });
  assert.strictEqual(mp.networkTier(), 'low');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P360);
});

run('4g with high RTT and low downlink -> low (360p)', () => {
  const mp = loadMediaPlayer({
    connection: { effectiveType: '4g', downlink: 2, rtt: 800 }
  });
  assert.strictEqual(mp.networkTier(), 'low');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.P360);
});

run('confident 4g -> highest/first (ORG)', () => {
  const mp = loadMediaPlayer({ connection: { effectiveType: '4g', downlink: 10 } });
  assert.strictEqual(mp.networkTier(), 'high');
  assert.strictEqual(mp.chooseDefault(LINKS), INDEX.ORG);
});

// 3. Quality-label ranking across the full ladder.
run('quality ladder: low=360p, medium/unknown=720p, high=ORG', () => {
  const low = loadMediaPlayer({ connection: { effectiveType: '2g' } });
  const medium = loadMediaPlayer({ connection: { effectiveType: '3g', downlink: 3 } });
  const high = loadMediaPlayer({ connection: { effectiveType: '4g', downlink: 10 } });

  assert.strictEqual(low.chooseDefault(LINKS), INDEX.P360, qualityAt(LINKS, low.chooseDefault(LINKS)));
  assert.strictEqual(medium.chooseDefault(LINKS), INDEX.P720, qualityAt(LINKS, medium.chooseDefault(LINKS)));
  assert.strictEqual(high.chooseDefault(LINKS), INDEX.ORG, qualityAt(LINKS, high.chooseDefault(LINKS)));
});

run('4K and 2160p rank equally (stable fallback order)', () => {
  const mp = loadMediaPlayer({ connection: { effectiveType: '2g' } });
  const direct = [
    { quality: '2160p', url: 'https://cdn.example/a.mp4' },
    { quality: '4K', url: 'https://cdn.example/b.mp4' }
  ];
  assert.strictEqual(mp.fallbackFor(direct), direct[0].url);
});

run('ORG is not used as the low-network direct fallback', () => {
  const mp = loadMediaPlayer({ connection: { effectiveType: '2g' } });
  const direct = [
    { quality: 'ORG', url: 'https://cdn.example/org.mp4' },
    { quality: '1080p', url: 'https://cdn.example/1080.mp4' }
  ];
  assert.strictEqual(mp.fallbackFor(direct), direct[1].url);
});

// 6. Missing quality metadata is handled safely.
run('missing metadata: labeled link still wins; all-unlabeled falls back to index 0', () => {
  const low = loadMediaPlayer({ connection: { effectiveType: '2g' } });
  const partial = [
    { url: 'https://cdn.example/unknown.mp4' },
    { quality: '360p', url: 'https://hls.example/360.m3u8' }
  ];
  assert.strictEqual(low.chooseDefault(partial), 1);

  const unlabeled = [{ url: 'https://cdn.example/unknown.mp4' }];
  assert.strictEqual(low.chooseDefault(unlabeled), 0);
  assert.strictEqual(low.chooseDefault([]), 0);
  assert.strictEqual(low.chooseDefault(null), 0);
});

console.log('media-player quality tests passed');
