'use strict';

const assert = require('assert');
const LivePlayer = require('../js/live-player.js');

function videoStub() {
  const listeners = {};
  let playCalls = 0;
  const buffered = {
    length: 0,
    ranges: [],
    start(i) { return this.ranges[i][0]; },
    end(i) { return this.ranges[i][1]; }
  };
  const video = {
    error: null,
    currentTime: 0,
    readyState: 0,
    buffered,
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
    setBuffered(ranges) {
      buffered.ranges = ranges;
      buffered.length = ranges.length;
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
    playCalls() { return playCalls; },
    listenerCount() {
      return Object.keys(listeners).reduce((sum, key) => sum + listeners[key].length, 0);
    }
  };
  return video;
}

function hlsStub() {
  const calls = {
    constructed: false,
    options: null,
    source: '',
    attached: null,
    destroyed: false,
    startLoadCalls: 0,
    recoverMediaErrorCalls: 0,
    recoverNetworkErrorCalls: 0,
    lastEngine: null
  };
  const handlers = {};
  function Hls(options) {
    calls.constructed = true;
    calls.options = options;
    calls.lastEngine = this;
    this.liveSyncPosition = 0;
    this.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
    this.loadSource = (url) => { calls.source = url; };
    this.attachMedia = (video) => { calls.attached = video; };
    this.startLoad = () => { calls.startLoadCalls += 1; };
    this.recoverMediaError = () => { calls.recoverMediaErrorCalls += 1; };
    this.recoverNetworkError = () => { calls.recoverNetworkErrorCalls += 1; };
    this.destroy = () => { calls.destroyed = true; };
  }
  Hls.isSupported = () => true;
  Hls.Events = {
    MANIFEST_PARSED: 'manifest',
    LEVELS_UPDATED: 'levels',
    FRAG_LOADED: 'fragment',
    BUFFER_APPENDED: 'appended',
    ERROR: 'error'
  };
  return {
    Hls,
    calls,
    emit(name, event, data) {
      (handlers[name] || []).slice().forEach(fn => fn(event, data));
    }
  };
}

function mpegtsStub() {
  const calls = {
    created: null,
    attached: null,
    loadCalls: 0,
    unloadCalls: 0,
    destroyed: false
  };
  const handlers = {};
  const player = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    attachMediaElement(video) { calls.attached = video; },
    load() { calls.loadCalls += 1; },
    unload() { calls.unloadCalls += 1; },
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
  return {
    mpegts,
    calls,
    emit(name, event, errorType, errorDetail, errorInfo) {
      (handlers[name] || []).slice().forEach(fn =>
        fn(event, errorType, errorDetail, errorInfo));
    }
  };
}

function handlersStub() {
  const calls = [];
  return {
    calls,
    onPlaying(arg) { calls.push(['playing', arg]); },
    onBuffering(msg) { calls.push(['buffering', msg]); },
    onError(msg, fatal, info) { calls.push(['error', msg, fatal, info]); },
    onStatus(msg) { calls.push(['status', msg]); },
    onAutoplayBlocked() { calls.push(['autoplay']); }
  };
}

function has(calls, name, fragment) {
  return calls.some(call => call[0] === name &&
    (!fragment || String(call[1]).indexOf(fragment) !== -1));
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function withNavigatorConnection(connection, fn) {
  const saved = Object.prototype.hasOwnProperty.call(global, 'navigator')
    ? global.navigator
    : undefined;
  const had = Object.prototype.hasOwnProperty.call(global, 'navigator');
  Object.defineProperty(global, 'navigator', {
    value: { connection: connection },
    configurable: true,
    writable: true
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (had) {
        Object.defineProperty(global, 'navigator', {
          value: saved,
          configurable: true,
          writable: true
        });
      } else {
        delete global.navigator;
      }
    });
}

async function run() {
  let checks = 0;
  function ok(condition, label) {
    assert.ok(condition, label);
    checks += 1;
  }

  // 1. HLS.js receives the URL and uses conservative live settings.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/playlist.m3u8', handlers
    });
    ok(hls.calls.constructed, 'Hls.js is constructed');
    ok(hls.calls.source === 'http://example.test/playlist.m3u8', 'HLS source is the detected URL');
    ok(hls.calls.attached === video, 'HLS is attached to the video element');
    const o = hls.calls.options;
    ok(o.enableWorker === true, 'HLS worker stays enabled');
    ok(o.lowLatencyMode === false, 'ordinary IPTV does not force low-latency mode');
    ok(o.liveSyncDurationCount === 3, 'HLS live sync target is 3 TLs');
    ok(o.liveMaxLatencyDurationCount === 8, 'HLS live latency is capped at 8 TLs');
    ok(o.maxLiveSyncPlaybackRate === 1.5, 'HLS live catch-up rate is bounded');
    ok(o.maxBufferLength === 12 && o.backBufferLength === 10,
      'HLS keeps a short live window instead of replaying 30s fragments');
    ok(o.maxBufferHole === 0.5, 'HLS can bridge small buffer holes');
    ok(o.startLevel === -1, 'HLS automatic quality selection is preserved');

    hls.emit('manifest', 'manifest', { levels: [
      { bitrate: 400000 }, { bitrate: 1200000 }, { bitrate: 3000000 }
    ] });
    ok(video.playCalls() === 0, 'manifest alone does not start playback');

    video.setBuffered([[0, 1.6]]);
    hls.emit('fragment', 'fragment', {});
    ok(video.playCalls() === 1, 'HLS starts once after playable media arrives');
    video.emit('playing');
    ok(has(handlers.calls, 'playing'), 'HLS playing event is forwarded');

    // A playlist refresh must not restart playback.
    hls.emit('manifest', 'manifest', { levels: [] });
    hls.emit('appended', 'appended', {});
    ok(video.playCalls() === 1, 'HLS playlist refresh does not restart playback');
  }

  // 2. MPEG-TS starts after a small real buffer, not a fixed 30 seconds.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    const instance = LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live/1784937', handlers
    });
    ok(ts.calls.created && ts.calls.created.config.type === 'mpegts', 'MPEG-TS engine uses TS type');
    ok(ts.calls.created.config.isLive === true, 'MPEG-TS stream is marked live');
    ok(ts.calls.created.config.url === 'http://example.test/live/1784937', 'MPEG-TS receives detected URL');
    ok(ts.calls.loadCalls === 1, 'MPEG-TS stream is loaded');

    const o = ts.calls.created.options;
    ok(o.enableWorker === true && o.lazyLoad === false, 'MPEG-TS worker and continuous load are kept');
    ok(o.stashInitialSize === 128 * 1024, 'MPEG-TS initial stash is reduced to 128 KB');
    ok(o.autoCleanupSourceBuffer === true, 'MPEG-TS source buffer cleanup stays enabled');
    ok(o.liveBufferLatencyChasing === true, 'MPEG-TS live latency chasing is enabled');
    ok(o.liveBufferLatencyMaxLatency === 10, 'MPEG-TS live latency cap is 10 seconds');
    ok(o.liveBufferLatencyMinRemain === 2, 'MPEG-TS keeps a 2 second recovery buffer');
    ok(!Object.prototype.hasOwnProperty.call(o, 'liveSync'), 'invalid liveSync option is removed');
    ok(!Object.prototype.hasOwnProperty.call(o, 'liveSyncTargetLatency'), 'invalid liveSyncTargetLatency option is removed');
    ok(!Object.prototype.hasOwnProperty.call(o, 'liveSyncMaxLatency'), 'invalid liveSyncMaxLatency option is removed');

    video.setBuffered([[0, 1.4]]);
    video.emit('progress');
    ok(video.playCalls() === 0, 'MPEG-TS does not start before the 1.5s target');

    video.setBuffered([[0, 1.6]]);
    video.emit('progress');
    ok(video.playCalls() === 1, 'MPEG-TS starts after a small buffer');

    video.emit('canplay');
    video.emit('loadeddata');
    video.emit('progress');
    ok(video.playCalls() === 1, 'MPEG-TS never issues duplicate play calls');

    // Simulated playback beyond the old 30s window.
    video.setBuffered([[0, 40]]);
    video.currentTime = 35;
    video.emit('progress');
    video.currentTime = 60;
    video.emit('progress');
    video.currentTime = 120;
    video.emit('progress');
    ok(video.playCalls() === 1, 'playback past 30/60/120s does not restart');
    ok(ts.calls.loadCalls === 1, 'no fixed-duration reload loop is created');

    video.emit('waiting');
    ok(has(handlers.calls, 'buffering', 'Buffering'), 'temporary stalls are reported as buffering');
    video.emit('stalled');
    ok(has(handlers.calls, 'buffering', 'stalled'), 'network stalls are reported without restarting');
    instance.destroy();
  }

  // 3. Channel switching removes all listeners and destroys the engine.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const first = LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live/swap', handlers: handlersStub()
    });
    video.setBuffered([[0, 2]]);
    video.emit('progress');
    ok(video.playCalls() === 1, 'first channel is playing before switch');

    // tv.html calls destroy() before starting the next channel.
    first.destroy();
    ok(ts.calls.destroyed, 'previous engine is destroyed on clean switch');
    ok(video.listenerCount() === 0, 'no duplicate playback listeners remain');
    const before = video.playCalls();
    video.emit('progress');
    ok(video.playCalls() === before, 'destroyed adapter ignores late progress events');

    const second = LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live/next', handlers: handlersStub()
    });
    ok(video.listenerCount() > 0, 'new channel registers its own listeners');
    second.destroy();
    ok(video.listenerCount() === 0, 'new channel also cleans up listeners');
  }

  // 4. A finite upstream response gets a bounded reconnect, not a 30s loop.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live/finite', handlers, reconnectDelayMs: 1
    });
    video.setBuffered([[0, 2]]);
    video.emit('progress');
    video.emit('ended');
    await tick();
    ok(ts.calls.unloadCalls === 1 && ts.calls.loadCalls === 2, 'first end reconnects once');
    video.emit('ended');
    await tick();
    ok(ts.calls.loadCalls === 3, 'second end reconnects once more');
    video.emit('ended');
    await tick();
    ok(ts.calls.loadCalls === 3, 'reconnect attempts are bounded');
    ok(has(handlers.calls, 'error', 'ended unexpectedly'), 'exhausted reconnect is reported');
  }

  // 5. HLS fatal network errors get one bounded retry.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/live.m3u8', handlers, reconnectDelayMs: 1
    });
    hls.emit('error', 'error', { fatal: true, type: 'networkError', details: 'fragmentLoadError' });
    await tick();
    ok(hls.calls.startLoadCalls === 1, 'temporary HLS network error resumes loading once');
    hls.emit('error', 'error', { fatal: true, type: 'networkError', details: 'fragmentLoadError' });
    await tick();
    ok(hls.calls.startLoadCalls === 1, 'HLS retry loop is bounded');
    ok(has(handlers.calls, 'error', 'HLS playback failed'), 'repeated HLS failure is reported');
  }

  // 6. HLS fatal decoding errors are still fatal immediately.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/x.m3u8', handlers
    });
    hls.emit('error', 'error', { fatal: true, type: 'mediaError', details: 'bufferAppendError' });
    ok(has(handlers.calls, 'error', 'HLS playback failed: bufferAppendError'),
      'HLS fatal error includes label and detail');
  }

  // 7. MPEG-TS errors show real details with safe console logging.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    const logs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => logs.push(args);
    try {
      LivePlayer.play({
        video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
        url: 'http://example.test/live?token=SUPERSECRET&user=alice', handlers
      });
      const circular = { msg: 'bad ts packet' };
      circular.self = circular;
      ts.emit('error', 'error', 'MediaError', 'FormatError', { code: -1, msg: circular });

      ok(has(handlers.calls, 'error', 'MPEG-TS parse error'), 'demux failure is labelled as MPEG-TS parse error');
      ok(has(handlers.calls, 'error', 'FormatError'), 'real error detail is shown');
      ok(!has(handlers.calls, 'error', '[object Object]'), 'object errors are not printed as [object Object]');
      ok(!has(handlers.calls, 'error', 'SUPERSECRET'), 'stream token is not exposed in the error');
      ok(!has(handlers.calls, 'error', 'alice'), 'stream username is not exposed in the error');
      const errorCall = handlers.calls.find(call => call[0] === 'error');
      ok(errorCall[3] && errorCall[3].category === 'mpegts-parse',
        'onError receives a structured category for playback failover');
      ok(errorCall[3].httpStatus === 0, 'onError has no invented HTTP status');

      const log = logs.find(entry => String(entry[0]).indexOf('[LiveTV][MPEG-TS] error') !== -1);
      ok(!!log, 'structured MPEG-TS console log is written');
      ok(log[1].errorType === 'MediaError', 'console log includes error type');
      ok(log[1].errorDetails === 'FormatError', 'console log includes error details');
      ok(log[1].httpStatus === null, 'no HTTP status is invented for parse errors');
      ok(log[1].errorInfo.indexOf('[Circular]') !== -1, 'circular error info is safe to serialize');
      ok(log[1].streamUrl.indexOf('SUPERSECRET') === -1 &&
         log[1].streamUrl.indexOf('alice') === -1, 'console stream URL is redacted');
    } finally {
      console.error = originalConsoleError;
    }
  }

  // 8. Decode/parse/HTTP errors are distinct; only recoverable ones reconnect.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live', handlers, reconnectDelayMs: 1
    });
    ts.emit('error', 'error', 'MediaError', 'MediaMSEError', { code: 9, msg: 'SourceBuffer append failed' });
    ok(has(handlers.calls, 'error', 'video decode error'), 'MSE failure is labelled as video decode error');
    ok(ts.calls.loadCalls === 1, 'decode error does not trigger reconnect');
  }
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live', handlers, reconnectDelayMs: 1
    });
    ts.emit('error', 'error', 'NetworkError', 'HttpStatusCodeInvalid', { code: 403, msg: 'Forbidden' });
    ok(has(handlers.calls, 'error', 'HTTP proxy error'), 'HTTP errors are labelled as proxy errors');
    ok(has(handlers.calls, 'error', '[HTTP 403]'), 'HTTP status is shown');
    const httpCall = handlers.calls.find(call => call[0] === 'error');
    ok(httpCall[3].category === 'http-proxy' && httpCall[3].httpStatus === 403,
      'onError exposes HTTP proxy status for failover decisions');
    ok(ts.calls.loadCalls === 1, 'non-recoverable HTTP 403 does not reconnect');
  }
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live/waking', handlers, reconnectDelayMs: 1
    });
    ts.emit('error', 'error', 'NetworkError', 'HttpStatusCodeInvalid',
      { code: 503, msg: 'Service Unavailable' });
    await tick();
    ok(ts.calls.loadCalls === 2, 'MPEG-TS retries once after a proxy 503');
    ok(has(handlers.calls, 'status', 'HTTP 503'), 'proxy wake retry is reported to the user');
    ts.emit('error', 'error', 'NetworkError', 'HttpStatusCodeInvalid',
      { code: 503, msg: 'Service Unavailable' });
    await tick();
    ts.emit('error', 'error', 'NetworkError', 'HttpStatusCodeInvalid',
      { code: 503, msg: 'Service Unavailable' });
    ok(has(handlers.calls, 'error', 'HTTP 503'), 'persistent HTTP 503 eventually fails clearly');
  }
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const handlers = handlersStub();
    LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live', handlers, reconnectDelayMs: 1
    });
    ts.emit('error', 'error', 'NetworkError', 'ConnectingTimeout', { code: -1, msg: 'timeout' });
    await tick();
    ok(ts.calls.loadCalls === 2, 'network timeout is treated as recoverable');
    ok(has(handlers.calls, 'error', 'network error') === false,
      'recoverable network error is reported as status, not fatal error');
  }

  // 9. A ready native element starts immediately; explicit prebuffer:false is honoured.
  {
    const video = videoStub();
    LivePlayer.play({
      video, engine: 'native', format: 'mp4',
      url: 'http://example.test/movie.mp4', handlers: handlersStub()
    });
    ok(video.src === 'http://example.test/movie.mp4', 'native engine sets video src');
    ok(video.playCalls() === 1, 'native engine starts playback');

    const tsVideo = videoStub();
    const ts = mpegtsStub();
    LivePlayer.play({
      video: tsVideo, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/live', prebuffer: false, handlers: handlersStub()
    });
    ok(tsVideo.playCalls() === 1, 'explicit prebuffer:false still starts immediately');
  }

  // 9. Browser decode errors are translated.
  {
    const video = videoStub();
    const handlers = handlersStub();
    LivePlayer.play({ video, engine: 'native', format: 'mp4', url: 'http://x/a.mp4', handlers });
    video.error = { code: 3, message: 'decode failed' };
    video.emit('error');
    ok(has(handlers.calls, 'error', 'Browser decoding error'), 'video error is labelled as browser decoding');
    ok(has(handlers.calls, 'error', 'could not be decoded'), 'video error keeps the original detail');
  }

  // 10. Autoplay rejection is reported without a fatal error.
  {
    const video = videoStub();
    video.play = () => Promise.reject(new Error('blocked'));
    const handlers = handlersStub();
    LivePlayer.play({ video, engine: 'native', format: 'mp4', url: 'http://x/a.mp4', handlers });
    await new Promise(resolve => setTimeout(resolve, 0));
    ok(has(handlers.calls, 'autoplay'), 'autoplay rejection is reported');
    ok(!has(handlers.calls, 'error'), 'autoplay rejection is not a fatal stream error');
  }

  // 11. Unsupported engines fail with an explanatory message.
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

  // 12. Initial buffering adapts to the connection without over-waiting.
  await withNavigatorConnection({ effectiveType: '2g', downlink: 0.4, saveData: false }, function () {
    const video = videoStub();
    const hls = hlsStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/slow.m3u8', handlers: handlersStub()
    });
    hls.emit('manifest', 'manifest', { levels: [] });
    video.setBuffered([[0, 0.9]]);
    hls.emit('fragment', 'fragment', {});
    ok(video.playCalls() === 0, 'slow link waits for at least one second of media');
    video.setBuffered([[0, 1.1]]);
    hls.emit('fragment', 'fragment', {});
    ok(video.playCalls() === 1, 'slow link starts without waiting for a large buffer');
  });
  await withNavigatorConnection({ effectiveType: '4g', downlink: 10, saveData: false }, function () {
    const video = videoStub();
    const hls = hlsStub();
    LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/fast.m3u8', handlers: handlersStub()
    });
    hls.emit('manifest', 'manifest', { levels: [] });
    video.setBuffered([[0, 1.4]]);
    hls.emit('fragment', 'fragment', {});
    ok(video.playCalls() === 0, 'fast link waits for a two second live window');
    video.setBuffered([[0, 2.1]]);
    hls.emit('fragment', 'fragment', {});
    ok(video.playCalls() === 1, 'fast link starts once enough media is present');
  });

  // 13. Quality modes use the real HLS variants available in the manifest.
  {
    const video = videoStub();
    const hls = hlsStub();
    const instance = LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/quality.m3u8', handlers: handlersStub(),
      quality: 'data-saver'
    });
    ok(hls.calls.options.startLevel === 0, 'data saver starts on the lowest variant');
    hls.emit('manifest', 'manifest', { levels: [
      { bitrate: 400000 }, { bitrate: 1200000 }, { bitrate: 3000000 }
    ] });
    ok(hls.calls.lastEngine.autoLevelCapping === 0, 'data saver caps to the lowest variant');
    ok(hls.calls.lastEngine.nextLevel === 0, 'data saver selects the lowest real level');
    ok(instance.setQuality('best') === 'best', 'quality mode can be changed while playing');
    ok(hls.calls.lastEngine.nextLevel === 2, 'best selects the highest real variant');
    ok(hls.calls.lastEngine.autoLevelCapping === 2, 'best caps to the highest real variant');
    instance.setQuality('balanced');
    ok(hls.calls.lastEngine.nextLevel === 1, 'balanced selects a real mid-range variant');
    instance.destroy();
  }

  // 14. The watchdog does not recover while the viewer intentionally pauses.
  {
    const video = videoStub();
    const hls = hlsStub();
    const instance = LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/paused.m3u8', handlers: handlersStub(),
      watchdogIntervalMs: 20, stallTimeoutMs: 60, reconnectDelayMs: 1
    });
    hls.emit('manifest', 'manifest', { levels: [] });
    video.setBuffered([[0, 2]]);
    hls.emit('fragment', 'fragment', {});
    video.emit('play');
    video.emit('pause');
    await wait(160);
    ok(hls.calls.startLoadCalls === 0, 'a paused stream is never treated as stalled');
    instance.destroy();
  }

  // 15. HLS stalls use lightweight recovery first, then a bounded fresh reconnect.
  {
    const video = videoStub();
    const hls = hlsStub();
    const handlers = handlersStub();
    const reconnects = [];
    const instance = LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/stalled.m3u8', handlers,
      watchdogIntervalMs: 20, stallTimeoutMs: 60, reconnectDelayMs: 1,
      onReconnect(reason, generation) { reconnects.push([reason, generation]); }
    });
    hls.emit('manifest', 'manifest', { levels: [] });
    video.setBuffered([[0, 2]]);
    hls.emit('fragment', 'fragment', {});
    video.emit('play');
    video.currentTime = 10;
    video.emit('timeupdate');

    await wait(180);
    ok(hls.calls.startLoadCalls >= 1, 'HLS stall first resumes the existing loader');
    ok(reconnects.length === 0, 'lightweight recovery is tried before a reconnect');
    await wait(180);
    ok(reconnects.length === 1, 'exhausted lightweight recovery requests one fresh reconnect');
    ok(reconnects[0][1] > 0, 'reconnect callback receives a cancellable generation');
    instance.destroy();
  }

  // 16. MPEG-TS stalls use unload/load rather than recreating the HLS player.
  {
    const video = videoStub();
    const ts = mpegtsStub();
    const instance = LivePlayer.play({
      video, mpegts: ts.mpegts, engine: 'mpegts.js', format: 'mpegts',
      url: 'http://example.test/stalled.ts', handlers: handlersStub(),
      watchdogIntervalMs: 20, stallTimeoutMs: 60, reconnectDelayMs: 1
    });
    video.setBuffered([[0, 2]]);
    video.emit('progress');
    video.emit('play');
    video.currentTime = 4;
    video.emit('timeupdate');
    await wait(180);
    ok(ts.calls.unloadCalls >= 1 && ts.calls.loadCalls >= 2,
      'MPEG-TS stall uses its own bounded unload/reload path');
    instance.destroy();
  }

  // 17. A channel switch cancels a pending reconnect from the old channel.
  {
    const video = videoStub();
    const hls = hlsStub();
    const reconnects = [];
    let sawStatus = false;
    const instance = LivePlayer.play({
      video, Hls: hls.Hls, engine: 'hls.js', format: 'hls',
      url: 'http://example.test/switch.m3u8',
      handlers: { onStatus(message) {
        if (/Reconnecting to the latest live data/.test(message)) sawStatus = true;
      } },
      watchdogIntervalMs: 20, stallTimeoutMs: 60, reconnectDelayMs: 100,
      onReconnect(reason, generation) { reconnects.push(generation); }
    });
    hls.emit('manifest', 'manifest', { levels: [] });
    video.setBuffered([[0, 2]]);
    hls.emit('fragment', 'fragment', {});
    video.emit('play');
    for (let i = 0; i < 40 && !sawStatus; i += 1) await wait(30);
    ok(sawStatus, 'watchdog reaches a pending reconnect before the channel switch');
    instance.destroy();
    await wait(500);
    ok(reconnects.length === 0, 'destroying the old channel cancels its pending reconnect');
  }

  console.log('live-player.test.js: ' + checks + ' checks passed');
}

run().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
