'use strict';

// Live adapter checks: detector-driven engine choice, real track discovery,
// MPEG-TS support, and no HLS forcing for extensionless URLs.
// Run with: node tests/live-stream.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'live-player.js'), 'utf8');

function makeVideo() {
  return {
    src: '',
    currentTime: 0,
    paused: true,
    buffered: { length: 0, end() { return 0; } },
    audioTracks: [],
    textTracks: [],
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
    removeEventListener() {},
    removeAttribute() {},
    load() {},
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); },
    canPlayType() { return ''; }
  };
}

function makeContext(detector, hlsImpl, mpegtsImpl) {
  const ctx = {
    console,
    Promise,
    setTimeout() { return 1; },
    clearTimeout() {},
    StreamDetector: detector,
    Hls: hlsImpl,
    mpegts: mpegtsImpl
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'live-player.js' });
  return ctx;
}

function detectorFor(kind, finalUrl) {
  return {
    fromMetadata() { return null; },
    detect() { return Promise.resolve({ kind, finalUrl: finalUrl || 'https://cdn.example/final' }); },
    extensionKind() { return ''; }
  };
}

function makeHls() {
  const instances = [];
  function Hls(config) {
    this.config = config;
    this.handlers = {};
    this.audioTracks = [
      { lang: 'en', name: 'English' },
      { lang: 'ar', name: 'Arabic' }
    ];
    this.audioTrack = 0;
    this.subtitleTracks = [{ lang: 'ar', name: 'Arabic' }];
    this.subtitleTrack = -1;
    instances.push(this);
  }
  Hls.isSupported = () => true;
  Hls.Events = {
    MANIFEST_PARSED: 'manifest',
    AUDIO_TRACKS_UPDATED: 'audiotracks',
    SUBTITLE_TRACKS_UPDATED: 'subtracks',
    AUDIO_TRACK_SWITCHED: 'audioswitched',
    ERROR: 'error'
  };
  Hls.prototype.on = function (name, fn) { this.handlers[name] = fn; };
  Hls.prototype.loadSource = function () {};
  Hls.prototype.attachMedia = function () {};
  Hls.prototype.destroy = function () {};
  return { Hls, instances };
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('PASS ' + name);
}

(async () => {
  await check('HLS.js exposes only real audio and subtitle tracks', async () => {
    const video = makeVideo();
    const { Hls, instances } = makeHls();
    let lastTracks = null;
    const ctx = makeContext(detectorFor('hls', 'https://cdn.example/playlist.m3u8'), Hls, null);
    const player = ctx.LiveStreamPlayer.create({ video, onTracks(t) { lastTracks = t; } });
    await player.play('https://origin.example/account/12345/3634');
    instances[0].handlers.manifest();
    assert.strictEqual(lastTracks.audio.length, 2);
    assert.strictEqual(lastTracks.subtitles.length, 1);
    assert.strictEqual(player.getAudioTracks()[1].language, 'ar');
    assert.strictEqual(player.setAudioTrack(1), true);
    assert.strictEqual(instances[0].audioTrack, 1);
    assert.strictEqual(player.setSubtitleTrack(0), true);
    assert.strictEqual(instances[0].subtitleTrack, 0);
  });

  await check('detected progressive stream uses native video, not HLS', async () => {
    const video = makeVideo();
    const { Hls, instances } = makeHls();
    const ctx = makeContext(detectorFor('progressive', 'https://cdn.example/movie.mp4'), Hls, null);
    const player = ctx.LiveStreamPlayer.create({ video });
    await player.play('http://example.com:80/account/12345/3632');
    assert.strictEqual(video.src, 'https://cdn.example/movie.mp4');
    assert.strictEqual(instances.length, 0);
  });

  await check('detected MPEG-TS stream uses mpegts.js with the final URL', async () => {
    const video = makeVideo();
    let created = null;
    const mpegts = {
      isSupported: () => true,
      Events: { ERROR: 'error' },
      createPlayer(config) {
        created = config;
        return {
          attachMediaElement() {},
          load() {},
          on() {},
          destroy() {}
        };
      }
    };
    const ctx = makeContext(detectorFor('mpegts', 'https://cdn.example/raw.ts'), undefined, mpegts);
    const player = ctx.LiveStreamPlayer.create({ video });
    await player.play('http://example.com:80/account/12345/3396');
    assert.strictEqual(created.type, 'mpegts');
    assert.strictEqual(created.url, 'https://cdn.example/raw.ts');
  });

  await check('stop clears tracks and invalidates stale callbacks', async () => {
    const video = makeVideo();
    const { Hls, instances } = makeHls();
    let lastTracks = null;
    const ctx = makeContext(detectorFor('hls'), Hls, null);
    const player = ctx.LiveStreamPlayer.create({ video, onTracks(t) { lastTracks = t; } });
    await player.play('https://origin.example/account/12345/3634');
    player.stop();
    instances[0].handlers.manifest();
    assert.strictEqual(JSON.stringify(lastTracks), JSON.stringify({ audio: [], subtitles: [] }));
  });

  console.log('live stream tests passed (' + passed + ' checks)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
