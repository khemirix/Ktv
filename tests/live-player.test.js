'use strict';

const assert = require('assert');
const LivePlayer = require('../js/live-player.js');

function videoStub() {
  const listeners = {};
  let playCalls = 0;
  const video = {
    error: null,
    currentTime: 0,
    buffered: { length: 0, end: () => 0 },
    src: '',
    addEventListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      listeners[name] = (listeners[name] || []).filter(f => f !== fn);
    },
    emit(name, arg) {
      (listeners[name] || []).slice().forEach(fn => fn(arg));
    },
    play() {
      playCalls += 1;
      return Promise.resolve();
    },
    pause() {},
    load() {},
    removeAttribute(name) {
      if (name === 'src') video.src = '';
    },
    canPlayType() { return 'probably'; },
    playCalls() { return playCalls; }
  };
  return video;
}

function hlsStub() {
  const calls = { constructed: false, source: '', attached: null, destroyed: false };
  const handlers = {};
  function Hls() {
    calls.constructed = true;
    this.on = (name, fn) => { handlers[name] = fn; };
    this.loadSource = (url) => { calls.source = url; };
    this.attachMedia = (video) => { calls.attached = video; };
    this.destroy = () => { calls.destroyed = true; };
  }
  Hls.isSupported = () => true;
  Hls.Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
  return { Hls, calls, handlers };
}

function mpegtsStub() {
  const calls = { created: null, attached: null, loaded: false, destroyed: false };
  const handlers = {};
  const player = {
    on(name, fn) { handlers[name] = fn; },
    attachMediaElement(video) { calls.attached = video; },
    load() { calls.loaded = true; },
    destroy() { calls.destroyed = true; },
    play() { return Promise.resolve(); }
  };
  const mpegts = {
    isSupported: () => true,
    Events: { ERROR: 'error' },
    createPlayer(config, options) {
      calls.created = { config, options };
      return player;
    }
  };
  return { mpegts, calls, handlers };
}

function handlersStub() {
  const calls = [];
  return {
    calls,
    onPlaying(arg) { calls.push(['playing', arg]); },
    onBuffering(msg) { calls.push(['buffering', msg]); },
    onError(msg, fatal) { calls.push(['error', msg, fatal]); },
    onStatus(msg) { calls.push(['status', msg]); },
    onAutoplayBlocked() { calls.push(['autoplay']); }
  };
}

async function run() {
  let checks = 0;
  function ok(condition, label) {
    assert.ok(condition, label);
    checks += 1;
  }
  function has(calls, name, fragment) {
    return calls.some(call => call[0] === name &&
      (!fragment || String(call[1]).indexOf(fragment) !== -1));
  }

  // 1. HLS.js receives the detected URL and reports playback.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video,
      Hls: hls.Hls,
      engine: 'hls.js',
      format: 'hls',
      url: 'http://example.test/playlist.m3u8',
      handlers
    });
    ok(hls.calls.constructed, 'Hls.js is constructed');
    ok(hls.calls.source === 'http://example.test/playlist.m3u8', 'HLS source is the detected URL');
    ok(hls.calls.attached === video, 'HLS is attached to the video element');
    video.emit('playing');
    ok(has(handlers.calls, 'playing'), 'HLS playing event is forwarded');
  }

  // 2. mpegts.js receives a TS URL with live options.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video,
      mpegts: ts.mpegts,
      engine: 'mpegts.js',
      format: 'mpegts',
      url: 'http://example.test/live/1784937',
      handlers
    });
    ok(ts.calls.created && ts.calls.created.config.type === 'mpegts', 'MPEG-TS engine uses TS type');
    ok(ts.calls.created.config.url === 'http://example.test/live/1784937', 'MPEG-TS receives detected URL');
    ok(ts.calls.created.options.enableWorker === true, 'MPEG-TS worker option is preserved');
    ok(ts.calls.loaded, 'MPEG-TS stream is loaded');
    video.buffered = { length: 1, end: () => 35 };
    video.emit('progress');
    ok(video.playCalls() === 1, 'MPEG-TS prebuffer starts playback after 30s');
  }

  // 3. Progressive video uses the native element.
  {
    const video = videoStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video,
      engine: 'native',
      format: 'mp4',
      url: 'http://example.test/movie.mp4',
      handlers
    });
    ok(video.src === 'http://example.test/movie.mp4', 'native engine sets video src');
    ok(video.playCalls() === 1, 'native engine starts playback');
  }

  // 4. HLS fatal errors are readable.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/x.m3u8', handlers
    });
    hls.handlers.error({}, { fatal: true, details: 'manifestLoadError' });
    ok(has(handlers.calls, 'error', 'HLS playback failed: manifestLoadError'),
      'HLS fatal error includes HLS label and detail');
  }

  // 5. MPEG-TS errors are readable.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live', handlers
    });
    ts.handlers.error({}, { details: 'demux error' });
    ok(has(handlers.calls, 'error', 'MPEG-TS playback failed: demux error'),
      'MPEG-TS error includes engine label and detail');
  }

  // 6. Browser decode errors are translated.
  {
    const video = videoStub();
    const handlers = handlersStub();
    LivePlayer.play({ video, engine: 'native', format: 'mp4', url: 'http://x/a.mp4', handlers });
    video.error = { code: 3, message: 'decode failed' };
    video.emit('error');
    ok(has(handlers.calls, 'error', 'Browser decoding error'), 'video error is labelled as browser decoding');
    ok(has(handlers.calls, 'error', 'could not be decoded'), 'video error keeps the original detail');
  }

  // 7. Autoplay rejection is reported without a fatal error.
  {
    const video = videoStub();
    video.play = () => Promise.reject(new Error('blocked'));
    const handlers = handlersStub();
    LivePlayer.play({ video, engine: 'native', format: 'mp4', url: 'http://x/a.mp4', handlers });
    await new Promise(resolve => setTimeout(resolve, 0));
    ok(has(handlers.calls, 'autoplay'), 'autoplay rejection is reported');
    ok(!has(handlers.calls, 'error'), 'autoplay rejection is not a fatal stream error');
  }

  // 8. Unsupported engines fail with an explanatory message.
  {
    const video = videoStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, engine: null, format: 'unsupported',
      message: 'This stream format is not supported by the browser. It requires server-side transcoding.',
      url: 'http://x/stream', handlers
    });
    ok(has(handlers.calls, 'error', 'server-side transcoding'), 'unsupported message is shown to the user');
    ok(video.src === '', 'unsupported format does not set a video src');
  }

  console.log('live-player.test.js: ' + checks + ' checks passed');
}

run().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
