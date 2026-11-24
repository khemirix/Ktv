/* Small playback adapter for Ktv Live TV.
 *
 * Takes a detection result from StreamDetector and starts exactly one engine:
 * hls.js, mpegts.js, or native <video>. Engine-specific errors are translated
 * into readable messages so the page never leaves a black video unexplained.
 */
(function (root) {
  'use strict';

  var MEDIA_ERRORS = {
    1: 'Playback was aborted',
    2: 'A network error occurred while loading the stream',
    3: 'The stream could not be decoded on this device',
    4: 'This stream format is not supported by this browser'
  };

  var MPEGTS_OPTIONS = {
    enableWorker: true,
    lazyLoad: false,
    autoCleanupSourceBuffer: true,
    liveBufferLatencyChasing: false,
    liveSync: false,
    liveSyncMaxLatency: 60,
    liveSyncTargetLatency: 30,
    stashInitialSize: 1024 * 1024
  };

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  function play(config) {
    config = config || {};
    var video = config.video;
    var handlers = config.handlers || {};
    var Hls = config.Hls || root.Hls;
    var mpegts = config.mpegts || root.mpegts;
    var alive = true;
    var failed = false;
    var engine = null;
    var listeners = [];

    function emit(name, a, b) {
      if (!alive || typeof handlers[name] !== 'function') return;
      try { handlers[name](a, b); } catch (e) {}
    }

    function fail(message, fatal) {
      if (!alive || failed) return;
      failed = true;
      emit('onError', message, !!fatal);
    }

    function status(message) { emit('onStatus', message); }

    function onVideoEvent(name, fn) {
      if (!video || typeof video.addEventListener !== 'function') return;
      video.addEventListener(name, fn);
      listeners.push({ name: name, fn: fn });
    }

    function safePlay() {
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

    onVideoEvent('playing', function () {
      emit('onPlaying', { engine: config.engine, format: config.format });
    });
    onVideoEvent('waiting', function () {
      emit('onBuffering', 'Buffering...');
    });
    onVideoEvent('error', function () {
      var code = video.error && video.error.code;
      var message = (code && MEDIA_ERRORS[code]) ||
        (video.error && video.error.message) || 'The browser could not play this stream.';
      fail('Browser decoding error: ' + message, true);
    });

    function startHlsJs() {
      if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
        fail(config.message || 'HLS.js is not available in this browser.', true);
        return;
      }
      engine = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30
      });

      var events = Hls.Events || {};
      if (events.MANIFEST_PARSED) {
        engine.on(events.MANIFEST_PARSED, function () {
          status('HLS manifest loaded');
          safePlay();
        });
      }
      if (events.ERROR) {
        engine.on(events.ERROR, function (event, data) {
          var detail = text((data && (data.details || data.type)) || 'HLS error');
          if (data && data.fatal) {
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
      var options = {};
      Object.keys(MPEGTS_OPTIONS).forEach(function (key) { options[key] = MPEGTS_OPTIONS[key]; });
      if (config.mpegtsOptions) {
        Object.keys(config.mpegtsOptions).forEach(function (key) {
          options[key] = config.mpegtsOptions[key];
        });
      }
      engine = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: config.url
      }, options);

      var events = mpegts.Events || {};
      if (events.ERROR) {
        engine.on(events.ERROR, function (event, data) {
          var detail = text((data && (data.details || data.type)) || 'MPEG-TS error');
          fail('MPEG-TS playback failed: ' + detail, true);
        });
      }

      engine.attachMediaElement(video);
      engine.load();

      if (config.prebuffer === false) {
        safePlay();
        return;
      }

      var prebuffered = false;
      onVideoEvent('progress', function checkBuffer() {
        if (prebuffered || !video.buffered || !video.buffered.length) return;
        var end = video.buffered.end(video.buffered.length - 1);
        var amount = Math.max(0, end - (video.currentTime || 0));
        emit('onBuffering', 'Buffering... ' + Math.min(30, Math.floor(amount)) + 's / 30s');
        if (amount >= 30) {
          prebuffered = true;
          safePlay();
          video.removeEventListener('progress', checkBuffer);
          listeners = listeners.filter(function (l) {
            return !(l.name === 'progress' && l.fn === checkBuffer);
          });
        }
      });
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
      safePlay();
    }

    status('Starting ' + text(config.engine || config.format || 'stream') + ' playback');

    if (config.engine === 'hls.js') startHlsJs();
    else if (config.engine === 'mpegts.js') startMpegts();
    else if (config.engine === 'native' || config.engine === 'native-hls') startNative();
    else fail(config.message || 'This stream format is not supported.', true);

    return {
      destroy: function () {
        alive = false;
        for (var i = 0; i < listeners.length; i += 1) {
          if (video && typeof video.removeEventListener === 'function') {
            try { video.removeEventListener(listeners[i].name, listeners[i].fn); } catch (e) {}
          }
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
      kind: function () { return config.engine || 'none'; }
    };
  }

  root.LivePlayer = { play: play };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LivePlayer;
})(typeof window !== 'undefined' ? window : globalThis);
