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

  // ── Initial quality default from browser connection hints ───────
  // The user can still pick any quality from the settings menu; this only
  // decides which link is selected when playback starts.
  function networkTier() {
    var c = (typeof navigator !== 'undefined') &&
      (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    if (!c) return 'unknown';
    if (c.saveData) return 'low';

    var effective = String(c.effectiveType || '').toLowerCase();
    var downlink = Number(c.downlink);
    var rtt = Number(c.rtt);

    if (effective === 'slow-2g' || effective === '2g' ||
        (downlink > 0 && downlink < 1.5) ||
        (rtt > 500 && downlink > 0 && downlink < 3)) {
      return 'low';
    }
    if (effective === '3g' || (downlink > 0 && downlink < 5)) return 'medium';
    if (effective === '4g' || downlink >= 5) return 'high';
    return 'unknown';
  }

  function qualityRank(link) {
    var label = String((link && (link.quality || link.name)) || '').toLowerCase();
    if (!label) return null;

    var k = /(\d+)\s*k\b/.exec(label);
    if (k) {
      var kValue = parseInt(k[1], 10);
      return kValue === 4 ? 2160 : kValue * 1000;
    }
    var p = /(\d{3,4})\s*p\b/.exec(label);
    if (p) return parseInt(p[1], 10);
    if (label.indexOf('org') !== -1 || label.indexOf('original') !== -1) return Infinity;
    return null;
  }

  function rankValue(rank) { return rank === null ? Infinity : rank; }

  function rankedLinks(links) {
    return links.map(function (link, i) {
      return { link: link, index: i, rank: qualityRank(link) };
    }).filter(function (entry) { return entry.rank !== null; })
      .sort(function (a, b) { return a.rank - b.rank || a.index - b.index; });
  }

  function chooseDefault(links) {
    if (!links || !links.length) return 0;
    var tier = networkTier();
    if (tier === 'unknown' || tier === 'high') return 0;

    var ranked = rankedLinks(links);
    if (!ranked.length) return 0;
    if (tier === 'low') return ranked[0].index;

    // Medium connections get the best option up to 720p.
    var balanced = ranked.filter(function (entry) { return entry.rank <= 720; });
    return (balanced.length ? balanced[balanced.length - 1] : ranked[0]).index;
  }

  function fallbackFor(links) {
    if (!links || !links.length) return '';
    var direct = links.map(function (link, i) {
      return { link: link, index: i, rank: qualityRank(link) };
    }).filter(function (entry) {
      return entry.link && entry.link.url && !isHls(entry.link.url);
    });
    if (!direct.length) return '';

    var tier = networkTier();
    if (tier === 'low' || tier === 'medium') {
      direct.sort(function (a, b) {
        return rankValue(a.rank) - rankValue(b.rank) || a.index - b.index;
      });
    }
    return direct[0].link.url;
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
      kind: function () { return s.kind; }
    };
  }

  return {
    create: create,
    isHls: isHls,
    networkTier: networkTier,
    chooseDefault: chooseDefault,
    fallbackFor: fallbackFor,
    supportsNativeHls: supportsNativeHls,
    hlsJsAvailable: hlsJsAvailable
  };
})();
