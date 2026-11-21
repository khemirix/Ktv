/* Cross-browser media playback for Ktv.
 *
 * Resolver.getLinks() returns a mix of direct MP4 URLs (label "ORG") and
 * HLS .m3u8 URLs (the numbered qualities). iPad Safari plays HLS natively;
 * Android Chrome needs HLS.js because it has no native HLS support.
 *
 * This module keeps that difference away from the rest of the app.
 */
var MediaPlayer = (function () {
  var MAX_RECOVERY = 2;

  var MEDIA_ERRORS = {
    1: 'Playback was aborted',
    2: 'A network error occurred while loading the video',
    3: 'The video could not be decoded on this device',
    4: 'This video format is not supported by this browser'
  };

  function isHls(url) {
    return /\.m3u8(?:[?#]|$)/i.test(String(url || ''));
  }

  function supportsNativeHls(video) {
    if (!video || !video.canPlayType) return false;
    return !!(video.canPlayType('application/vnd.apple.mpegurl') ||
              video.canPlayType('application/x-mpegURL'));
  }

  function hlsJsAvailable() {
    return typeof window.Hls !== 'undefined' &&
           typeof window.Hls.isSupported === 'function' &&
           window.Hls.isSupported();
  }

  function create(video, handlers) {
    handlers = handlers || {};

    var s = {
      hls: null,
      url: '',
      fallbackUrl: '',
      token: 0,
      retries: 0,
      kind: 'none',
      autoplay: true
    };

    function onError(message, fatal) {
      if (handlers.onError) handlers.onError(message, !!fatal);
    }

    function onStatus(kind) {
      if (handlers.onStatus) handlers.onStatus(kind);
    }

    function safePlay() {
      if (!s.autoplay) return;
      try {
        var p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function (e) {
            if (handlers.onAutoplayBlocked) handlers.onAutoplayBlocked(e);
          });
        }
      } catch (e) {
        if (handlers.onAutoplayBlocked) handlers.onAutoplayBlocked(e);
      }
    }

    function teardownHls() {
      if (!s.hls) return;
      try { s.hls.destroy(); } catch (e) {}
      s.hls = null;
    }

    function clearVideo() {
      try { video.pause(); } catch (e) {}
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}
    }

    function useFallback(token) {
      var fallback = s.fallbackUrl;
      teardownHls();
      if (fallback && token === s.token) {
        loadDirect(fallback, token);
      } else {
        onError('This stream could not be played on this device.', true);
      }
    }

    function onHlsError(data, token) {
      if (token !== s.token) return;
      var detail = data && (data.details || data.type) || 'HLS error';

      // Non-fatal errors are usually recovered by HLS.js itself.
      if (!data || !data.fatal) {
        console.warn('[HLS] ' + detail);
        return;
      }

      if (s.retries < MAX_RECOVERY && s.hls) {
        s.retries += 1;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          onError('Network hiccup (' + detail + ') — retrying…');
          s.hls.startLoad();
          return;
        }
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          onError('Media glitch (' + detail + ') — recovering…');
          s.hls.recoverMediaError();
          return;
        }
      }

      onError('Unable to play this HLS stream: ' + detail, true);
      useFallback(token);
    }

    function loadHlsJs(url, token) {
      if (!hlsJsAvailable()) {
        onError('HLS playback requires HLS.js, which failed to load. Try the ORG quality.', true);
        useFallback(token);
        return;
      }

      s.kind = 'hls.js';
      onStatus('hls.js');

      s.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60
      });

      s.hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        if (token === s.token) safePlay();
      });
      s.hls.on(window.Hls.Events.ERROR, function (event, data) {
        onHlsError(data, token);
      });

      s.hls.loadSource(url);
      s.hls.attachMedia(video);
    }

    function loadNativeHls(url) {
      s.kind = 'native-hls';
      onStatus('native-hls');
      video.src = url;
      try { video.load(); } catch (e) {}
      safePlay();
    }

    function loadDirect(url, token) {
      s.kind = 'direct';
      onStatus('direct');
      video.src = url;
      try { video.load(); } catch (e) {}
      safePlay();
    }

    function onVideoError() {
      if (!s.url) return;
      var code = video.error && video.error.code;
      var message = (code && MEDIA_ERRORS[code]) ||
                    (video.error && video.error.message) ||
                    'Video playback failed';

      // Native HLS can fail on an odd network; the direct MP4 is a safety net.
      if (s.kind === 'native-hls' && s.fallbackUrl) {
        onError('Native HLS failed (' + message + ') — trying direct video.');
        loadDirect(s.fallbackUrl, s.token);
        return;
      }
      onError(message, true);
    }

    function onPlaying() {
      if (handlers.onPlaying) handlers.onPlaying();
    }

    video.addEventListener('error', onVideoError);
    video.addEventListener('playing', onPlaying);

    function load(url, options) {
      options = options || {};

      s.token += 1;
      s.url = '';
      s.retries = 0;
      teardownHls();
      clearVideo();

      s.url = url;
      s.fallbackUrl = options.fallbackUrl || '';
      s.autoplay = options.autoplay !== false;

      if (!url) {
        onError('No video URL was returned for this quality.', true);
        return;
      }

      if (isHls(url)) {
        if (supportsNativeHls(video)) loadNativeHls(url);
        else loadHlsJs(url, s.token);
      } else {
        loadDirect(url, s.token);
      }
    }

    function destroy() {
      s.token += 1;
      s.url = '';
      teardownHls();
      video.removeEventListener('error', onVideoError);
      video.removeEventListener('playing', onPlaying);
      clearVideo();
    }

    return {
      load: load,
      destroy: destroy,
      resync: function () {
        if (s.hls && s.hls.startLoad) {
          try { s.hls.startLoad(); } catch (e) {}
        }
      },
      kind: function () { return s.kind; }
    };
  }

  return {
    create: create,
    isHls: isHls,
    supportsNativeHls: supportsNativeHls,
    hlsJsAvailable: hlsJsAvailable
  };
})();
