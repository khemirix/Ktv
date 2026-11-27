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

  // Start with a small playable window. Waiting for a fixed 30s buffer made
  // live channels start behind the live edge and made the first window look
  // like a repeating loop. Slow links ask for 1s, fast links for 2s.
  var MIN_INITIAL_BUFFER_SECONDS = 0.75;
  var MAX_INITIAL_BUFFER_SECONDS = 2;
  var INITIAL_START_TIMEOUT_MS = 5000;
  var WATCHDOG_INTERVAL_MS = 1000;
  var STALL_TIMEOUT_MS = 6000;
  var RECONNECT_DELAY_MS = 1000;
  var MAX_RECONNECT_DELAY_MS = 4000;
  var MAX_LIVE_RECONNECTS = 2;
  var LIVE_EDGE_LATENCY_SECONDS = 2;

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
    // Keeping the forward/back window short prevents an old 30s fragment
    // window from being replayed after a stall. It does not change ABR.
    maxBufferLength: 12,
    backBufferLength: 10,
    maxBufferHole: 0.5,
    // -1 keeps hls.js automatic quality selection enabled for master playlists.
    startLevel: -1
  };

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  // Error payloads from mpegts.js are a mix of strings and plain objects.
  // String(object) produces "[object Object]", so objects are formatted with
  // JSON instead. Circular references are replaced with "[Circular]".
  function normalizeForJson(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) {
      return { name: value.name, message: value.message, code: value.code };
    }
    if (seen && seen.has(value)) return '[Circular]';
    if (seen) seen.add(value);
    var out = Array.isArray(value) ? [] : {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        out[key] = normalizeForJson(value[key], seen);
      }
    }
    if (seen) seen.delete(value);
    return out;
  }

  function safeJson(value) {
    try {
      var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
      return JSON.stringify(normalizeForJson(value, seen));
    } catch (e) {
      return '[unserializable error information]';
    }
  }

  function printable(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) {
      var message = (value.name ? value.name + ': ' : '') + (value.message || '');
      if (value.code !== undefined) message += ' (code ' + printable(value.code) + ')';
      return message || safeJson(value);
    }
    return safeJson(value);
  }

  function httpStatusOf(value) {
    var status = Number(value);
    return isFinite(status) && status >= 100 && status < 600 ? status : 0;
  }

  function sanitizeStreamUrl(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    try {
      var parsed = new URL(raw);
      if (parsed.username || parsed.password) {
        parsed.username = '[redacted]';
        parsed.password = '[redacted]';
      }
      Array.from(parsed.searchParams.keys()).forEach(function (key) {
        parsed.searchParams.set(key, '[redacted]');
      });
      if (parsed.hash) parsed.hash = '[redacted]';
      return parsed.href;
    } catch (e) {
      return String(raw)
        .replace(/\/\/[^/@\s]+:[^/@\s]+@/, '//[redacted]:[redacted]@')
        .replace(/([?&][^=&#]+=)[^&#]*/g, '$1[redacted]')
        .replace(/#.*$/, '#[redacted]');
    }
  }

  function errorInfoSummary(info) {
    if (info === null || info === undefined) return '';
    if (typeof info !== 'object') return printable(info);
    var parts = [];
    if (info.code !== undefined) parts.push('code ' + printable(info.code));
    if (info.status !== undefined) parts.push('status ' + printable(info.status));
    if (info.msg !== undefined || info.message !== undefined) {
      parts.push(printable(info.msg !== undefined ? info.msg : info.message));
    }
    return parts.join(', ') || safeJson(info);
  }

  function classifyMpegtsError(errorType, errorDetail, httpStatus) {
    var type = printable(errorType).toLowerCase();
    var detail = printable(errorDetail).toLowerCase();
    if (httpStatus || detail.indexOf('httpstatuscodeinvalid') !== -1 || detail.indexOf('http') !== -1) {
      return { key: 'http-proxy', label: 'HTTP proxy error' };
    }
    if (detail.indexOf('format') !== -1 || detail.indexOf('demux') !== -1 ||
        detail.indexOf('mpeg-ts') !== -1 || detail.indexOf('mpegts') !== -1) {
      return { key: 'mpegts-parse', label: 'MPEG-TS parse error' };
    }
    if (type === 'mediaerror' || detail.indexOf('mse') !== -1 ||
        detail.indexOf('decode') !== -1 || detail.indexOf('codec') !== -1 ||
        detail.indexOf('sourcebuffer') !== -1) {
      return { key: 'decode', label: 'video decode error' };
    }
    if (type === 'networkerror' || detail.indexOf('timeout') !== -1 ||
        detail.indexOf('earlyeof') !== -1 || detail.indexOf('exception') !== -1 ||
        detail.indexOf('network') !== -1) {
      return { key: 'network', label: 'network error' };
    }
    return { key: 'other', label: 'MPEG-TS error' };
  }

  function isRecoverableMpegtsError(category, errorDetail, httpStatus) {
    if (httpStatus === 503 || httpStatus === 502 || httpStatus === 504) return true;
    var detail = printable(errorDetail).toLowerCase();
    return category.key === 'network' &&
      (detail.indexOf('timeout') !== -1 || detail.indexOf('earlyeof') !== -1);
  }

  function logMpegtsError(fields) {
    if (typeof console === 'undefined' || typeof console.error !== 'function') return;
    console.error('[LiveTV][MPEG-TS] error', {
      category: fields.category.label,
      errorType: fields.errorType,
      errorDetails: fields.errorDetails,
      httpStatus: fields.httpStatus || null,
      errorInfo: fields.errorInfo,
      streamUrl: fields.streamUrl
    });
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

  function bufferedEndOf(video) {
    var buffered = video && video.buffered;
    if (!buffered || typeof buffered.length !== 'number') return 0;
    var end = 0;
    for (var i = 0; i < buffered.length; i += 1) {
      var value = Number(buffered.end(i));
      if (isFinite(value) && value > end) end = value;
    }
    return end;
  }

  function connectionOf() {
    var nav = root && root.navigator;
    return (nav && (nav.connection || nav.mozConnection || nav.webkitConnection)) || null;
  }

  function networkClass() {
    var connection = connectionOf();
    var downlink = Number(connection && connection.downlink);
    var effective = text(connection && connection.effectiveType).toLowerCase();
    if (connection && connection.saveData) return 'slow';
    if (effective === 'slow-2g' || effective === '2g' ||
        (isFinite(downlink) && downlink > 0 && downlink < 1.5)) return 'slow';
    if (effective === '4g' || (isFinite(downlink) && downlink >= 5)) return 'fast';
    return 'normal';
  }

  function estimatedBandwidth() {
    var downlink = Number(connectionOf() && connectionOf().downlink);
    if (isFinite(downlink) && downlink > 0) return downlink * 1000 * 1000;
    return 0;
  }

  function targetInitialBuffer(quality) {
    var speed = networkClass();
    var target = speed === 'slow' ? 1 : speed === 'fast' ? 2 : 1.5;
    if (quality === 'data-saver') target = Math.min(target, 1);
    return clampNumber(target, 1.5, MIN_INITIAL_BUFFER_SECONDS, MAX_INITIAL_BUFFER_SECONDS);
  }

  // Only proxy URLs get a fresh query marker. Direct/signed URLs are never
  // modified, so provider signatures and credentials stay untouched.
  function freshLiveUrl(raw) {
    var url = text(raw);
    try {
      var parsed = new URL(url);
      if (!/\/api\/stream(?:\/|\?|$)/i.test(parsed.pathname) && !parsed.searchParams.has('url')) {
        return url;
      }
      parsed.searchParams.set('_ktv', String(Date.now()));
      return parsed.href;
    } catch (e) {
      return url;
    }
  }

  function normalizeQuality(value) {
    var mode = text(value).toLowerCase();
    return ['auto', 'data-saver', 'balanced', 'best'].indexOf(mode) !== -1 ? mode : 'auto';
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
    var fullReconnectPending = false;
    var recoveryGeneration = 0;
    var lastHlsErrorType = '';
    var listeners = [];
    var readyListeners = [];
    var timers = [];
    var watchdogTimer = null;
    var userPaused = false;
    var internalPause = false;
    var lastProgressAt = Date.now();
    var lastTime = Number(video && video.currentTime) || 0;
    var lastBufferEnd = 0;
    var initialArmed = false;
    var initialCheck = null;
    var quality = normalizeQuality(config.quality);
    var hlsLevels = [];
    var appliedQualityKey = '';
    var formatKind = text(config.format).toLowerCase();
    var isHls = engineKind === 'hls.js' || engineKind === 'native-hls' || formatKind === 'hls';
    var initialBufferSeconds = clampNumber(
      config.initialBufferSeconds,
      targetInitialBuffer(quality),
      MIN_INITIAL_BUFFER_SECONDS,
      MAX_INITIAL_BUFFER_SECONDS
    );
    var reconnectDelayMs = clampNumber(config.reconnectDelayMs, RECONNECT_DELAY_MS, 0, MAX_RECONNECT_DELAY_MS);
    var stallTimeoutMs = clampNumber(config.stallTimeoutMs, STALL_TIMEOUT_MS, 50, 60000);
    var watchdogIntervalMs = clampNumber(config.watchdogIntervalMs, WATCHDOG_INTERVAL_MS, 10, 10000);

    function emit(name, a, b, c) {
      if (!alive || typeof handlers[name] !== 'function') return;
      try { handlers[name](a, b, c); } catch (e) {}
    }

    function fail(message, fatal, info) {
      if (!alive || failed || stopped) return;
      failed = true;
      stopWatchdog();
      emit('onError', message, !!fatal, info);
    }

    function warn(message) {
      if (!alive || stopped) return;
      emit('onError', message, false);
    }

    function status(message) { emit('onStatus', message); }

    function markProgress() {
      lastProgressAt = Date.now();
    }

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

    function stopWatchdog() {
      if (watchdogTimer !== null) clearInterval(watchdogTimer);
      watchdogTimer = null;
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

    function seekLiveEdge(reason) {
      if (!video) return false;
      var seekable = video.seekable;
      var livePosition = Number(engine && engine.liveSyncPosition);
      var target = -1;
      var lower = 0;
      var upper = -1;

      if (seekable && typeof seekable.length === 'number' && seekable.length > 0) {
        var index = seekable.length - 1;
        lower = Number(seekable.start(index));
        upper = Number(seekable.end(index));
        if (isFinite(upper)) target = upper - LIVE_EDGE_LATENCY_SECONDS;
      }
      if (isFinite(livePosition) && livePosition > 0 && (upper < 0 || livePosition <= upper)) {
        target = Math.max(target, livePosition);
      }
      if (!isFinite(target) || target < 0) return false;
      if (lower > 0) target = Math.max(target, lower);
      if (upper >= 0) target = Math.min(target, upper);

      var current = Number(video.currentTime) || 0;
      if (target <= current + 0.5) return false;
      try { video.currentTime = target; } catch (e) { return false; }
      markProgress();
      status(reason + ' Resuming near the live edge.');
      return true;
    }

    function applyQuality(announce) {
      if (!engine || !isHls || engineKind !== 'hls.js') return;
      var key = quality + ':' + hlsLevels.length + ':' + hlsLevels.map(function (level) {
        return Number(level && (level.bitrate || level.avgBitrate || level.peakBitrate)) || 0;
      }).join(',');
      if (key === appliedQualityKey) return;
      appliedQualityKey = key;

      var ranked = hlsLevels.map(function (level, index) {
        return {
          index: index,
          bitrate: Number(level && (level.bitrate || level.avgBitrate || level.peakBitrate)) || 0
        };
      }).filter(function (item) { return item.bitrate > 0; })
        .sort(function (a, b) { return a.bitrate - b.bitrate; });
      if (!ranked.length) return;

      var chosen = -1;
      if (quality === 'data-saver') {
        chosen = ranked[0].index;
      } else if (quality === 'best') {
        chosen = ranked[ranked.length - 1].index;
      } else if (quality === 'balanced') {
        var budget = estimatedBandwidth() * 0.6 || 1200000;
        chosen = ranked[0].index;
        ranked.forEach(function (item) {
          if (item.bitrate <= budget) chosen = item.index;
        });
      }

      try {
        engine.autoLevelCapping = chosen >= 0 ? chosen : -1;
        engine.nextLevel = chosen;
      } catch (e) {}
      if (announce && quality !== 'auto') {
        status('Live quality: ' + quality.replace('-', ' '));
      }
    }

    function setQuality(mode) {
      quality = normalizeQuality(mode);
      appliedQualityKey = '';
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem('ktvLiveQuality', quality);
        }
      } catch (e) {}
      applyQuality(true);
      return quality;
    }

    function watchdogTick() {
      if (!alive || stopped || failed || !playStarted || userPaused) return;
      if (video && video.paused) {
        // A browser pause without an explicit play event is usually autoplay
        // blocking, not a stalled live stream.
        return;
      }

      var now = Date.now();
      var time = Number(video && video.currentTime) || 0;
      var bufferEnd = bufferedEndOf(video);
      if (time > lastTime + 0.05 || bufferEnd > lastBufferEnd + 0.05) markProgress();
      lastTime = time;
      lastBufferEnd = bufferEnd;

      if (now - lastProgressAt < stallTimeoutMs) return;
      if (isHls) seekLiveEdge('Live playback was behind the live edge.');
      if (recoveryGeneration > 0 && fullReconnectPending) return;
      lightweightRecover('Live playback stopped progressing.');
    }

    function startWatchdog() {
      if (watchdogTimer !== null || !playStarted) return;
      watchdogTimer = setInterval(watchdogTick, watchdogIntervalMs);
      if (watchdogTimer && typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
    }

    function safePlay(force) {
      if (stopped || playStarted) return;
      if (!force && readyStateOf(video) < 2 && bufferedSeconds(video) < initialBufferSeconds) return;
      playStarted = true;
      userPaused = false;
      markProgress();
      lastTime = Number(video && video.currentTime) || 0;
      lastBufferEnd = bufferedEndOf(video);
      clearReadyListeners();
      clearTimers();
      startWatchdog();

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
      if (stopped || playStarted || initialArmed) return;
      initialArmed = true;
      function checkReady() {
        if (stopped || playStarted) return;
        if (readyStateOf(video) >= 2 || bufferedSeconds(video) >= initialBufferSeconds) {
          safePlay(false);
        }
      }
      initialCheck = checkReady;
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

    function recoveryDelay(attempt) {
      var exponent = Math.max(0, (Number(attempt) || 1) - 1);
      return Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * Math.pow(2, exponent));
    }

    function requestFullReconnect(reason) {
      if (stopped || failed || fullReconnectPending) return;
      if (typeof config.onReconnect !== 'function') {
        warn(reason);
        return;
      }
      fullReconnectPending = true;
      recoveryGeneration += 1;
      var generation = recoveryGeneration;
      status('Reconnecting to the latest live data...');
      addTimer(function () {
        if (stopped) return;
        config.onReconnect(reason, generation);
      }, recoveryDelay(reconnects + 1));
    }

    function beginRecovery(reason, action, options) {
      options = options || {};
      if (stopped || reconnecting || failed || fullReconnectPending) return false;
      var limit = options.maxAttempts || MAX_LIVE_RECONNECTS;
      if (reconnects >= limit) {
        if (typeof options.onExhausted === 'function') options.onExhausted();
        else requestFullReconnect(reason);
        return true;
      }
      reconnects += 1;
      reconnecting = true;
      status(reason);
      addTimer(function () {
        if (stopped) return;
        reconnecting = false;
        try { action(); } catch (e) {
          fail('Live playback failed: ' + (printable(e) || 'recovery failed'), true, {
            category: isHls ? 'hls' : 'network',
            httpStatus: 0,
            proxyBase: sanitizeStreamUrl(config.url)
          });
          return;
        }
        markProgress();
      }, recoveryDelay(reconnects));
      return true;
    }

    function reconnectMpegts(reason, fatalWhenExhausted, onExhausted) {
      return beginRecovery(reason + ' Retrying...', function () {
        try {
          if (engine && typeof engine.unload === 'function') engine.unload();
        } catch (e) {}
        try {
          if (engine && typeof engine.load === 'function') engine.load();
        } catch (e) {
          fail('MPEG-TS playback failed: ' + (printable(e) || 'reconnect failed'), true, {
            category: 'network',
            httpStatus: 0,
            proxyBase: sanitizeStreamUrl(config.url)
          });
          return;
        }
        playStarted = false;
        initialArmed = false;
        initialCheck = null;
        armInitialStart();
      }, {
        onExhausted: onExhausted || function () {
          if (fatalWhenExhausted) fail(reason, true);
          else warn(reason);
        }
      });
    }

    function lightweightRecover(reason) {
      if (isHls && engineKind === 'hls.js') {
        return beginRecovery(reason, function () {
          var type = lastHlsErrorType;
          var recovered = false;
          if (type === 'mediaError' && engine && typeof engine.recoverMediaError === 'function') {
            engine.recoverMediaError();
            recovered = true;
          } else if (type === 'networkError' && engine && typeof engine.recoverNetworkError === 'function') {
            engine.recoverNetworkError();
            recovered = true;
          } else if (engine && typeof engine.startLoad === 'function') {
            engine.startLoad();
            recovered = true;
          }
          if (!recovered && engine && typeof engine.loadSource === 'function') {
            engine.loadSource(freshLiveUrl(config.url));
          }
          seekLiveEdge(reason);
        }, {
          onExhausted: function () { requestFullReconnect(reason); }
        });
      }
      if (engineKind === 'mpegts.js') {
        return reconnectMpegts(reason, false, function () { requestFullReconnect(reason); });
      }
      requestFullReconnect(reason);
      return true;
    }

    onVideoEvent('playing', function () {
      userPaused = false;
      markProgress();
      emit('onPlaying', { engine: config.engine, format: config.format });
    }, true);
    onVideoEvent('play', function () { userPaused = false; markProgress(); }, true);
    onVideoEvent('pause', function () {
      if (!internalPause && playStarted) userPaused = true;
    }, true);
    onVideoEvent('timeupdate', function () {
      var time = Number(video && video.currentTime) || 0;
      if (time > lastTime + 0.05) { markProgress(); lastTime = time; }
    }, true);
    onVideoEvent('progress', function () {
      var end = bufferedEndOf(video);
      if (end > lastBufferEnd + 0.05) { markProgress(); lastBufferEnd = end; }
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
      if (quality === 'data-saver') options.startLevel = 0;
      engine = new Hls(options);
      hlsLevels = [];
      appliedQualityKey = '';

      var events = Hls.Events || {};
      if (events.MANIFEST_PARSED) {
        engine.on(events.MANIFEST_PARSED, function (event, data) {
          status('HLS manifest loaded');
          if (data && Array.isArray(data.levels)) hlsLevels = data.levels;
          applyQuality(false);
          if (initialCheck) initialCheck();
          // MANIFEST_PARSED alone is not proof that playable media is ready.
        });
      }
      if (events.LEVELS_UPDATED) {
        engine.on(events.LEVELS_UPDATED, function (event, data) {
          if (data && Array.isArray(data.levels)) hlsLevels = data.levels;
          applyQuality(false);
        });
      }
      if (events.FRAG_LOADED || events.BUFFER_APPENDED) {
        var onMedia = function () {
          markProgress();
          if (initialCheck) initialCheck();
        };
        if (events.FRAG_LOADED) engine.on(events.FRAG_LOADED, onMedia);
        if (events.BUFFER_APPENDED) engine.on(events.BUFFER_APPENDED, onMedia);
      }
      if (events.ERROR) {
        engine.on(events.ERROR, function (event, data) {
          var detail = text((data && (data.details || data.type)) || 'HLS error');
          if (data && data.fatal) {
            var type = text(data.type);
            lastHlsErrorType = type;
            if (type === 'networkError' && reconnects < 1) {
              beginRecovery('HLS network error; resuming...', function () {
                if (engine && typeof engine.startLoad === 'function') engine.startLoad();
                seekLiveEdge('HLS network recovered.');
              }, { maxAttempts: 1 });
              return;
            }
            fail('HLS playback failed: ' + detail, true, {
              category: type === 'networkError' ? 'network' : 'hls',
              httpStatus: 0,
              proxyBase: sanitizeStreamUrl(config.url)
            });
          } else {
            status('HLS warning: ' + detail);
          }
        });
      }

      engine.loadSource(config.url);
      engine.attachMedia(video);
      armInitialStart();
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
        // mpegts.js 1.7.3 emits:
        //   EVENT_ERROR, errorType, errorDetail, errorInfo
        // See player/mse-player.js: network/demux/MSE errors all use this shape.
        engine.on(events.ERROR, function (event, errorType, errorDetail, errorInfo) {
          if (reconnecting) return;

          var infoStatus = errorInfo && typeof errorInfo === 'object' ?
            (errorInfo.code || errorInfo.status || errorInfo.statusCode) : errorInfo;
          var detailStatus = errorDetail && typeof errorDetail === 'object' ?
            (errorDetail.code || errorDetail.status || errorDetail.statusCode) : 0;
          var statusCode = httpStatusOf(infoStatus) || httpStatusOf(detailStatus);
          var category = classifyMpegtsError(errorType, errorDetail, statusCode);
          var typeText = printable(errorType);
          var detailText = printable(errorDetail);
          var infoText = errorInfoSummary(errorInfo);
          var streamUrl = sanitizeStreamUrl(config.url);

          logMpegtsError({
            category: category,
            errorType: typeText,
            errorDetails: detailText,
            httpStatus: statusCode,
            errorInfo: infoText,
            streamUrl: streamUrl
          });

          var summary = category.label;
          if (detailText) summary += ': ' + detailText;
          if (statusCode) summary += ' [HTTP ' + statusCode + ']';
          if (infoText) summary += ' — ' + infoText;

          if (isRecoverableMpegtsError(category, errorDetail, statusCode)) {
            reconnectMpegts('MPEG-TS playback issue (' + summary + ')', true);
            return;
          }
          fail('MPEG-TS playback failed (' + summary + ')', true, {
            category: category.key,
            httpStatus: statusCode,
            proxyBase: streamUrl
          });
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
      if (isHls) armInitialStart();
      else safePlay(true);
    }

    status('Starting ' + text(config.engine || config.format || 'stream') + ' playback');

    if (engineKind === 'hls.js') startHlsJs();
    else if (engineKind === 'mpegts.js') startMpegts();
    else if (engineKind === 'native' || engineKind === 'native-hls') startNative();
    else fail(config.message || 'This stream format is not supported.', true);

    return {
      destroy: function () {
        stopped = true;
        alive = false;
        recoveryGeneration += 1;
        clearTimers();
        stopWatchdog();
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
          internalPause = true;
          try { video.pause(); } catch (e) {}
          try { video.removeAttribute('src'); } catch (e) {}
          try { video.load(); } catch (e) {}
        }
      },
      kind: function () { return engineKind || 'none'; },
      setQuality: function (mode) { return setQuality(mode); },
      quality: function () { return quality; }
    };
  }

  root.LivePlayer = { play: play };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LivePlayer;
})(typeof window !== 'undefined' ? window : globalThis);
