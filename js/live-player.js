/* Small playback adapter for Ktv Live TV.
 *
 * Takes a detection result from StreamDetector and starts exactly one engine:
 * hls.js, mpegts.js, or native <video>. This file is Live-TV-only; it never
 * touches Movies or TV Shows playback.
 */
(function (root) {
  'use strict';

  var MEDIA_ERRORS = {
    1: 'Playback was aborted',
    2: 'A network error occurred while loading the stream',
    3: 'The stream could not be decoded on this device',
    4: 'This stream format is not supported by this browser'
  };

  // Start as soon as the browser has a small amount of playable media. Waiting
  // for a fixed 30s buffer made live channels start ~30s behind and made the
  // initial window look like a repeating loop.
  var INITIAL_BUFFER_SECONDS = 1.5;
  var MIN_INITIAL_BUFFER_SECONDS = 0.5;
  var MAX_INITIAL_BUFFER_SECONDS = 5;
  var INITIAL_START_TIMEOUT_MS = 5000;
  var RECONNECT_DELAY_MS = 1000;
  var MAX_RECONNECT_DELAY_MS = 4000;
  var MAX_LIVE_RECONNECTS = 2;

  var MPEGTS_OPTIONS = {
    enableWorker: true,
    enableStashBuffer: true,
    // mpegts.js waits for this much data before its first dispatch. 1 MB took
    // many seconds on slow links; 128 KB is enough for a first keyframe.
    stashInitialSize: 128 * 1024,
    lazyLoad: false,
    autoCleanupSourceBuffer: true,
    // These are the real mpegts.js live-edge options. The previous
    // liveSync/liveSyncTargetLatency names were not recognised by the library.
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 10,
    liveBufferLatencyMinRemain: 2
  };

  var HLS_OPTIONS = {
    enableWorker: true,
    // Ordinary IPTV playlists are not Low-Latency HLS. Starting in LL mode can
    // starve slow connections, so follow the normal live edge instead.
    lowLatencyMode: false,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    maxLiveSyncPlaybackRate: 1.5,
    maxBufferLength: 30,
    maxBufferHole: 0.5,
    backBufferLength: 30,
    // -1 keeps hls.js automatic quality selection enabled for master playlists.
    startLevel: -1
  };

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  function clampNumber(value, fallback, min, max) {
    var number = Number(value);
    if (!isFinite(number)) number = Number(fallback);
    number = Math.max(min, Math.min(max, number));
    return number;
  }

  function mergeOptions(defaults, overrides) {
    var merged = {};
    Object.keys(defaults || {}).forEach(function (key) { merged[key] = defaults[key]; });
    Object.keys(overrides || {}).forEach(function (key) { merged[key] = overrides[key]; });
    return merged;
  }

  function readyStateOf(video) {
    var ready = Number(video && video.readyState);
    return isFinite(ready) ? ready : 0;
  }

  function bufferedSeconds(video) {
    var buffered = video && video.buffered;
    var current = Number(video && video.currentTime);
    if (!isFinite(current)) current = 0;
    if (!buffered || typeof buffered.length !== 'number' || buffered.length < 1) return 0;

    var firstStart = null;
    var firstEnd = null;
    for (var i = 0; i < buffered.length; i += 1) {
      var start = typeof buffered.start === 'function' ? Number(buffered.start(i)) : 0;
      var end = Number(buffered.end(i));
      if (!isFinite(start) || !isFinite(end) || end <= start) continue;
      if (firstStart === null) { firstStart = start; firstEnd = end; }
      if (current >= start && current < end) return Math.max(0, end - current);
    }
    // Before play begins currentTime may be 0 while the first buffered range
    // starts slightly later; that range is still the playable initial window.
    if (current < firstStart && firstStart !== null) {
      return Math.max(0, firstEnd - firstStart);
    }
    return 0;
  }

  function play(config) {
    config = config || {};
    var video = config.video;
    var handlers = config.handlers || {};
    var Hls = config.Hls || root.Hls;
    var mpegts = config.mpegts || root.mpegts;

    var alive = true;
    var stopped = false;
    var failed = false;
    var engine = null;
    var engineKind = text(config.engine);
    var playStarted = false;
    var reconnecting = false;
    var reconnects = 0;
    var listeners = [];
    var readyListeners = [];
    var timers = [];
    var initialBufferSeconds = clampNumber(
      config.initialBufferSeconds,
      INITIAL_BUFFER_SECONDS,
      MIN_INITIAL_BUFFER_SECONDS,
      MAX_INITIAL_BUFFER_SECONDS
    );
    var reconnectDelayMs = clampNumber(config.reconnectDelayMs, RECONNECT_DELAY_MS, 0, MAX_RECONNECT_DELAY_MS);

    function emit(name, a, b) {
      if (!alive || typeof handlers[name] !== 'function') return;
      try { handlers[name](a, b); } catch (e) {}
    }

    function fail(message, fatal) {
      if (!alive || failed || stopped) return;
      failed = true;
      emit('onError', message, !!fatal);
    }

    function warn(message) {
      if (!alive || stopped) return;
      emit('onError', message, false);
    }

    function status(message) { emit('onStatus', message); }

    function addTimer(fn, delay) {
      var timer = setTimeout(function () {
        timers = timers.filter(function (item) { return item !== timer; });
        if (alive && !stopped) fn();
      }, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
      timers.push(timer);
      return timer;
    }

    function clearTimers() {
      for (var i = 0; i < timers.length; i += 1) clearTimeout(timers[i]);
      timers = [];
    }

    function removeListener(name, fn) {
      if (!video || typeof video.removeEventListener !== 'function') return;
      video.removeEventListener(name, fn);
      listeners = listeners.filter(function (item) {
        return !(item.name === name && item.fn === fn);
      });
    }

    function onVideoEvent(name, fn, persistent) {
      if (!video || typeof video.addEventListener !== 'function') return;
      video.addEventListener(name, fn);
      var entry = { name: name, fn: fn, persistent: !!persistent };
      listeners.push(entry);
      if (!persistent) readyListeners.push(entry);
    }

    function clearReadyListeners() {
      for (var i = 0; i < readyListeners.length; i += 1) {
        removeListener(readyListeners[i].name, readyListeners[i].fn);
      }
      readyListeners = [];
    }

    function safePlay(force) {
      if (stopped || playStarted) return;
      if (!force && readyStateOf(video) < 2 && bufferedSeconds(video) < initialBufferSeconds) return;
      playStarted = true;
      clearReadyListeners();
      clearTimers();

      if (!video || typeof video.play !== 'function') return;
      var attempt;
      try { attempt = video.play(); } catch (e) {
        emit('onAutoplayBlocked', e);
        return;
      }
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(function (e) { emit('onAutoplayBlocked', e); });
      }
    }

    function armInitialStart() {
      if (stopped || playStarted) return;
      function checkReady() {
        if (stopped || playStarted) return;
        if (readyStateOf(video) >= 2 || bufferedSeconds(video) >= initialBufferSeconds) {
          safePlay(false);
        }
      }
      onVideoEvent('progress', checkReady, false);
      onVideoEvent('loadeddata', checkReady, false);
      onVideoEvent('canplay', checkReady, false);
      checkReady();
      addTimer(function () {
        if (stopped || playStarted) return;
        if (readyStateOf(video) >= 1 || bufferedSeconds(video) > 0) {
          safePlay(true);
        } else {
          status('Waiting for stream data...');
        }
      }, INITIAL_START_TIMEOUT_MS);
    }

    function reconnectMpegts(reason, fatalWhenExhausted) {
      if (stopped || reconnecting || failed) return;
      if (reconnects >= MAX_LIVE_RECONNECTS) {
        if (fatalWhenExhausted) fail(reason, true);
        else warn(reason);
        return;
      }
      reconnecting = true;
      reconnects += 1;
      playStarted = false;
      status(reason + ' Retrying...');
      addTimer(function () {
        if (stopped) return;
        try {
          if (engine && typeof engine.unload === 'function') engine.unload();
        } catch (e) {}
        try {
          if (engine && typeof engine.load === 'function') engine.load();
        } catch (e) {
          reconnecting = false;
          fail('MPEG-TS playback failed: ' + text(e && e.message || 'reconnect failed'), true);
          return;
        }
        reconnecting = false;
        armInitialStart();
      }, Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * reconnects));
    }

    onVideoEvent('playing', function () {
      emit('onPlaying', { engine: config.engine, format: config.format });
    }, true);
    onVideoEvent('waiting', function () {
      emit('onBuffering', 'Buffering...');
    }, true);
    onVideoEvent('stalled', function () {
      emit('onBuffering', 'Network stalled; waiting for live data...');
    }, true);
    onVideoEvent('ended', function () {
      if (stopped) return;
      if (engineKind === 'mpegts.js') reconnectMpegts('Live stream ended unexpectedly.', false);
      else warn('Live stream ended unexpectedly.');
    }, true);
    onVideoEvent('error', function () {
      var code = video.error && video.error.code;
      var message = (code && MEDIA_ERRORS[code]) ||
        (video.error && video.error.message) || 'The browser could not play this stream.';
      fail('Browser decoding error: ' + message, true);
    }, true);

    function startHlsJs() {
      if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
        fail(config.message || 'HLS.js is not available in this browser.', true);
        return;
      }
      var options = mergeOptions(HLS_OPTIONS, config.hlsOptions);
      engine = new Hls(options);

      var events = Hls.Events || {};
      if (events.MANIFEST_PARSED) {
        engine.on(events.MANIFEST_PARSED, function () {
          status('HLS manifest loaded');
          safePlay(true);
        });
      }
      if (events.ERROR) {
        engine.on(events.ERROR, function (event, data) {
          var detail = text((data && (data.details || data.type)) || 'HLS error');
          if (data && data.fatal) {
            var type = text(data.type);
            if (type === 'networkError' && reconnects < 1) {
              reconnects += 1;
              status('HLS network error; resuming...');
              addTimer(function () {
                if (engine && typeof engine.startLoad === 'function') engine.startLoad();
              }, reconnectDelayMs);
              return;
            }
            fail('HLS playback failed: ' + detail, true);
          } else {
            status('HLS warning: ' + detail);
          }
        });
      }

      engine.loadSource(config.url);
      engine.attachMedia(video);
    }

    function startMpegts() {
      if (!mpegts || typeof mpegts.isSupported !== 'function' || !mpegts.isSupported()) {
        fail(config.message || 'MPEG-TS playback is not available in this browser.', true);
        return;
      }
      var options = mergeOptions(MPEGTS_OPTIONS, config.mpegtsOptions);
      engine = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: config.url
      }, options);

      var events = mpegts.Events || {};
      if (events.ERROR) {
        // mpegts.js emits (event, errorType, detail, info); accept the older
        // single-object shape too so tests and wrappers stay compatible.
        engine.on(events.ERROR, function (event, errorType, data, info) {
          var payload = (data && typeof data === 'object') ? data :
            ((errorType && typeof errorType === 'object') ? errorType : null);
          var meta = (info && typeof info === 'object') ? info :
            ((data && typeof data === 'object') ? data : null);
          var detail = text((payload && (payload.details || payload.type)) ||
            data || (errorType && typeof errorType === 'string' && errorType !== 'NetworkError'
              ? errorType : '') || 'MPEG-TS error');
          var statusCode = Number((meta && (meta.code || meta.status)) ||
            (payload && (payload.code || payload.status)) ||
            (payload && payload.info && payload.info.code));
          if (statusCode === 503 || detail.indexOf('503') !== -1) {
            reconnectMpegts('Proxy is waking up (HTTP 503).', true);
            return;
          }
          fail('MPEG-TS playback failed: ' + detail, true);
        });
      }

      engine.attachMediaElement(video);
      engine.load();

      if (config.prebuffer === false) {
        safePlay(true);
        return;
      }
      armInitialStart();
    }

    function startNative() {
      if (!video) {
        fail('No video element is available for playback.', true);
        return;
      }
      video.src = config.url;
      if (typeof video.load === 'function') {
        try { video.load(); } catch (e) {}
      }
      safePlay(true);
    }

    status('Starting ' + text(config.engine || config.format || 'stream') + ' playback');

    if (engineKind === 'hls.js') startHlsJs();
    else if (engineKind === 'mpegts.js') startMpegts();
    else if ((engineKind === 'native' || engineKind === 'native-hls')) startNative();
    else fail(config.message || 'This stream format is not supported.', true);

    return {
      destroy: function () {
        stopped = true;
        alive = false;
        clearTimers();
        clearReadyListeners();
        for (var i = 0; i < listeners.length; i += 1) {
          if (!video || typeof video.removeEventListener !== 'function') break;
          video.removeEventListener(listeners[i].name, listeners[i].fn);
        }
        listeners = [];
        if (engine && typeof engine.destroy === 'function') {
          try { engine.destroy(); } catch (e) {}
        }
        if (video) {
          try { video.pause(); } catch (e) {}
          try { video.removeAttribute('src'); } catch (e) {}
          try { video.load(); } catch (e) {}
        }
      },
      kind: function () { return engineKind || 'none'; }
    };
  }

  root.LivePlayer = { play: play };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LivePlayer;
})(typeof window !== 'undefined' ? window : globalThis);
