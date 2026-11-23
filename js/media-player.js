/* Cross-browser media playback for Ktv.
 *
 * Resolver.getLinks() returns a mix of direct MP4 URLs and HLS .m3u8 URLs.
 * iPad Safari plays HLS natively; Android Chrome needs HLS.js. This module
 * also chooses a conservative initial quality when playback starts.
 */
var MediaPlayer = (function () {
  var MAX_RECOVERY = 2;
  var HLS_INIT_TIMEOUT_MS = 12000;
  var PROBE_TIMEOUT_MS = 1500;
  var PROBE_CACHE_MS = 5 * 60 * 1000;
  var probeCache = null;

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
    return typeof window !== 'undefined' &&
           typeof window.Hls !== 'undefined' &&
           typeof window.Hls.isSupported === 'function' &&
           window.Hls.isSupported();
  }

  function positiveNumber(value) {
    var n = Number(value);
    return (isFinite(n) && n > 0) ? n : 0;
  }

  function connectionInfo() {
    if (typeof navigator === 'undefined') return null;
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  // Synchronous hint-based tier. Save Data always wins. When a real downlink
  // estimate exists it takes priority over the coarse effectiveType label.
  function networkTier() {
    var c = connectionInfo();
    if (!c) return 'unknown';
    if (c.saveData) return 'low';

    var downlink = positiveNumber(c.downlink);
    var rtt = positiveNumber(c.rtt);
    var effective = String(c.effectiveType || '').toLowerCase();

    if (downlink > 0) {
      if (downlink < 1.5 || (rtt > 500 && downlink < 3)) return 'low';
      if (downlink < 5) return 'medium';
      return 'high';
    }

    if (effective === 'slow-2g' || effective === '2g') return 'low';
    if (effective === '3g') return 'medium';
    // Without a measured downlink, 4g alone is not enough to assume high.
    if (effective === '4g') return 'medium';
    return 'unknown';
  }

  function probeUrl() {
    try {
      var base = (typeof document !== 'undefined' && document.baseURI) ||
                 (typeof window !== 'undefined' && window.location && window.location.href) ||
                 '';
      if (!base) return '';
      return new URL('css/style.css', base).href + '?_ktv_probe=' + Date.now();
    } catch (e) {
      return '';
    }
  }

  // iOS Safari does not expose navigator.connection. Fetch one small,
  // cache-busted same-origin stylesheet and time it. This is coarse, but it
  // avoids guessing "highest" on an unknown connection without downloading a
  // large test file. Results are cached briefly.
  function estimateNetworkTier() {
    var tier = networkTier();
    if (tier !== 'unknown') return Promise.resolve(tier);

    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    if (probeCache && (now - probeCache.at) < PROBE_CACHE_MS) {
      return Promise.resolve(probeCache.tier);
    }

    var url = probeUrl();
    if (!url || typeof fetch !== 'function') {
      probeCache = { tier: 'unknown', at: now };
      return Promise.resolve('unknown');
    }

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, PROBE_TIMEOUT_MS)
      : null;
    var start = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : now;

    return fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) return 'unknown';
      var header = (res.headers && res.headers.get) ? res.headers.get('content-length') : null;
      return res.arrayBuffer().then(function (buf) {
        var bytes = Number(header) || (buf && buf.byteLength) || 0;
        var end = (typeof performance !== 'undefined' && performance.now)
          ? performance.now() : Date.now();
        var seconds = (end - start) / 1000;
        if (bytes < 2048 || seconds <= 0) return 'unknown';
        var mbps = (bytes * 8) / (seconds * 1000000);
        if (mbps < 1.5) return 'low';
        if (mbps < 5) return 'medium';
        return 'high';
      });
    }).catch(function () {
      return 'unknown';
    }).then(function (result) {
      if (timer) clearTimeout(timer);
      probeCache = { tier: result, at: (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0 };
      return result;
    });
  }

  function qualityRank(link) {
    var label = String((link && (link.quality || link.name || link.label)) || '').toLowerCase();
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
    if (!Array.isArray(links)) return [];
    return links.map(function (link, i) {
      return { link: link, index: i, rank: qualityRank(link) };
    }).filter(function (entry) {
      return entry.rank !== null;
    }).sort(function (a, b) {
      return a.rank - b.rank || a.index - b.index;
    });
  }

  // Never assumes links[0] is the default; the API order is ignored.
  function chooseDefault(links, tier) {
    if (!Array.isArray(links) || !links.length) return 0;
    var ranked = rankedLinks(links);
    if (!ranked.length) return 0;
    tier = tier || networkTier();

    if (tier === 'high') return ranked[ranked.length - 1].index;
    if (tier === 'low') return ranked[0].index;

    // Medium, unknown, and failed-probe cases stay conservative.
    var balanced = ranked.filter(function (entry) { return entry.rank <= 720; });
    return (balanced.length ? balanced[balanced.length - 1] : ranked[0]).index;
  }

  function fallbackFor(links, tier) {
    if (!Array.isArray(links) || !links.length) return '';
    var direct = links.map(function (link, i) {
      return { link: link, index: i, rank: qualityRank(link) };
    }).filter(function (entry) {
      return entry.link && entry.link.url && !isHls(entry.link.url);
    });
    if (!direct.length) return '';

    tier = tier || networkTier();
    if (tier === 'high') {
      direct.sort(function (a, b) {
        return rankValue(b.rank) - rankValue(a.rank) || a.index - b.index;
      });
    } else {
      // Low, medium, and unknown pick the smallest direct file available.
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
      fallbackUsed: false,
      kind: 'none',
      autoplay: true,
      initTimer: null,
      resumeTime: null,
      playingNotified: false,
      audioTracks: [],
      currentAudioIndex: -1,
      audioSignature: null,
      audioListeners: []
    };

    function onError(message, fatal) {
      if (handlers.onError) handlers.onError(message, !!fatal);
    }

    function onStatus(kind) {
      if (handlers.onStatus) handlers.onStatus(kind);
    }

    // ── Real audio-track discovery ────────────────────────────────
    // Only metadata exposed by HLS.js or native video.audioTracks is used.
    // Direct MP4 files with no exposed metadata produce an empty list.
    function notifyAudioTracks() {
      var snapshot = s.audioTracks.slice();
      if (handlers.onAudioTracksChanged) {
        try { handlers.onAudioTracksChanged(snapshot, s.currentAudioIndex); } catch (e) {}
      }
      s.audioListeners.slice().forEach(function (fn) {
        try { fn(snapshot, s.currentAudioIndex); } catch (e) {}
      });
    }

    function hlsTrackIndex() {
      return (s.hls && typeof s.hls.audioTrack === 'number') ? s.hls.audioTrack : -1;
    }

    function hlsTracks() {
      var raw = (s.hls && s.hls.audioTracks) || [];
      var selected = hlsTrackIndex();
      return Array.prototype.map.call(raw, function (track, i) {
        var attrs = track.attrs || {};
        var lang = track.lang || track.language || attrs.LANGUAGE || attrs.language || '';
        var label = track.name || track.label || lang || ('Track ' + (i + 1));
        return {
          index: i,
          id: track.id !== undefined && track.id !== null ? track.id : i,
          groupId: track.groupId || attrs['GROUP-ID'] || '',
          language: String(lang || ''),
          label: String(label || ''),
          characteristics: track.characteristics || attrs.CHARACTERISTICS || attrs.characteristics || '',
          default: !!(track.default || attrs.DEFAULT || attrs.default),
          selected: i === selected,
          source: 'hls.js'
        };
      });
    }

    function nativeTracks() {
      var list = video.audioTracks;
      if (!list || !list.length) return [];
      return Array.prototype.map.call(list, function (track, i) {
        var lang = track.language || track.lang || '';
        return {
          index: i,
          id: track.id !== undefined && track.id !== null ? track.id : i,
          groupId: '',
          language: String(lang || ''),
          label: String(track.label || lang || ('Track ' + (i + 1)) || ''),
          characteristics: String(track.characteristics || ''),
          default: !!track.default,
          selected: !!track.enabled,
          source: 'native'
        };
      });
    }

    function trackSignature(tracks) {
      return tracks.map(function (t) {
        return [t.index, t.id, t.language, t.label, t.characteristics,
                t.default ? 1 : 0, t.selected ? 1 : 0].join(':');
      }).join('|');
    }

    function resetAudioState() {
      s.audioTracks = [];
      s.currentAudioIndex = -1;
      s.audioSignature = null;
      notifyAudioTracks();
    }

    function refreshAudioTracks(force) {
      var tracks = [];
      if (s.kind === 'hls.js' && s.hls) tracks = hlsTracks();
      else if (video.audioTracks && video.audioTracks.length) tracks = nativeTracks();

      var signature = trackSignature(tracks);
      if (!force && signature === s.audioSignature) return;

      s.audioTracks = tracks;
      s.audioSignature = signature;
      s.currentAudioIndex = tracks.length
        ? (tracks.filter(function (t) { return t.selected; })[0] || tracks[0]).index
        : -1;
      notifyAudioTracks();
    }

    function getAudioTracks() { return s.audioTracks.slice(); }

    function getCurrentAudioTrack() {
      if (!s.audioTracks.length) return -1;
      if (s.kind === 'hls.js' && s.hls) {
        var idx = hlsTrackIndex();
        return (idx >= 0 && idx < s.audioTracks.length) ? idx : s.currentAudioIndex;
      }
      return s.currentAudioIndex;
    }

    function setAudioTrack(index) {
      index = Number(index);
      if (!isFinite(index) || index < 0 || index >= s.audioTracks.length) return false;

      if (s.kind === 'hls.js' && s.hls && s.hls.audioTracks && s.hls.audioTracks.length) {
        try { s.hls.audioTrack = index; } catch (e) { return false; }
      } else if (video.audioTracks && video.audioTracks.length) {
        try {
          for (var i = 0; i < video.audioTracks.length; i++) {
            video.audioTracks[i].enabled = (i === index);
          }
        } catch (e) { return false; }
      } else {
        return false;
      }
      s.currentAudioIndex = index;
      refreshAudioTracks(true);
      return true;
    }

    function onAudioTracksChanged(fn) {
      if (typeof fn !== 'function') return function () {};
      s.audioListeners.push(fn);
      var removed = false;
      return function () {
        if (removed) return;
        removed = true;
        s.audioListeners = s.audioListeners.filter(function (f) { return f !== fn; });
      };
    }

    // play() is only attempted after a user action. If Safari blocks it, we
    // leave the native controls visible instead of retrying in a loop.
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
      if (s.initTimer) {
        clearTimeout(s.initTimer);
        s.initTimer = null;
      }
      if (!s.hls) return;
      try { s.hls.destroy(); } catch (e) {}
      s.hls = null;
    }

    function clearVideo() {
      try { video.pause(); } catch (e) {}
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}
    }

    function applyResumeTime() {
      if (s.kind !== 'direct' || s.resumeTime === null) return;
      try { video.currentTime = s.resumeTime; } catch (e) {}
      s.resumeTime = null;
    }

    function onLoadedMetadata() {
      applyResumeTime();
      refreshAudioTracks();
    }

    function onPlaying() {
      if (!s.url || s.playingNotified) return;
      applyResumeTime();
      refreshAudioTracks();
      s.playingNotified = true;
      if (handlers.onPlaying) {
        handlers.onPlaying({ url: s.url, kind: s.kind });
      }
    }

    function useFallback(token, reason) {
      if (token !== s.token || s.fallbackUsed) return;
      s.fallbackUsed = true;
      var fallback = s.fallbackUrl;
      teardownHls();
      if (fallback && fallback !== s.url) {
        onError(reason + ' — trying the direct video.');
        s.url = fallback;
        loadDirect(fallback, token);
      } else {
        onError(reason || 'This stream could not be played.', true);
      }
    }

    function onHlsError(data, token) {
      if (token !== s.token) return;
      var detail = (data && (data.details || data.type)) || 'HLS error';
      if (!data || !data.fatal) {
        console.warn('[HLS] ' + detail);
        return;
      }

      var errorTypes = (window.Hls && window.Hls.ErrorTypes) || {};
      var networkError = data.type === errorTypes.NETWORK_ERROR ||
        /manifestload|manifestparse|fragload|fragmentload|bufferappend|bufferappenderror/i.test(detail);
      var mediaError = data.type === errorTypes.MEDIA_ERROR ||
        /media|decode|manifestparsing|manifestincompatible/i.test(detail);

      if (s.retries < MAX_RECOVERY && s.hls) {
        s.retries += 1;
        if (networkError && typeof s.hls.startLoad === 'function') {
          onError('Network hiccup (' + detail + ') — retrying…');
          s.hls.startLoad();
          return;
        }
        if (mediaError && typeof s.hls.recoverMediaError === 'function') {
          onError('Media glitch (' + detail + ') — recovering…');
          s.hls.recoverMediaError();
          return;
        }
      }

      useFallback(token, 'Unable to play this HLS stream: ' + detail);
    }

    function loadHlsJs(url, token) {
      if (!hlsJsAvailable()) {
        useFallback(token, 'HLS.js is unavailable');
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

      s.initTimer = setTimeout(function () {
        if (token !== s.token) return;
        useFallback(token, 'HLS manifest did not load in time');
      }, HLS_INIT_TIMEOUT_MS);

      var hlsEvents = (window.Hls && window.Hls.Events) || {};
      ['AUDIO_TRACKS_UPDATED', 'AUDIO_TRACK_SWITCHED'].forEach(function (name) {
        if (!hlsEvents[name]) return;
        s.hls.on(hlsEvents[name], function () {
          if (token !== s.token || !s.hls) return;
          refreshAudioTracks(true);
        });
      });

      s.hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        if (token !== s.token) return;
        if (s.initTimer) { clearTimeout(s.initTimer); s.initTimer = null; }
        refreshAudioTracks(true);
        safePlay();
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
      refreshAudioTracks();
      safePlay();
    }

    function loadDirect(url, token) {
      if (token !== s.token) return;
      s.kind = 'direct';
      onStatus('direct');
      video.src = url;
      refreshAudioTracks(true);
      try { video.load(); } catch (e) {}
      safePlay();
    }

    function onVideoError() {
      if (!s.url) return;
      var code = video.error && video.error.code;
      var message = (code && MEDIA_ERRORS[code]) ||
                    (video.error && video.error.message) ||
                    'Video playback failed';

      if (!s.fallbackUsed && s.fallbackUrl && s.fallbackUrl !== s.url &&
          (s.kind === 'native-hls' || s.kind === 'direct')) {
        useFallback(s.token, message);
        return;
      }

      onError(message + ' The link may have expired — reopen this title for a fresh stream.', true);
    }

    video.addEventListener('error', onVideoError);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    function load(url, options) {
      options = options || {};

      var previousUrl = s.url;
      var canResume = !!previousUrl && !isHls(previousUrl) && !isHls(url) &&
        isFinite(video.currentTime) && video.currentTime > 0;

      s.token += 1;
      s.url = '';
      s.retries = 0;
      s.fallbackUsed = false;
      s.playingNotified = false;
      s.resumeTime = canResume ? video.currentTime : null;
      resetAudioState();

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
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      resetAudioState();
      clearVideo();
    }

    return {
      load: load,
      destroy: destroy,
      resync: function () {
        if (s.hls && typeof s.hls.startLoad === 'function') {
          try { s.hls.startLoad(); } catch (e) {}
        }
        refreshAudioTracks();
      },
      kind: function () { return s.kind; },
      getAudioTracks: getAudioTracks,
      getCurrentAudioTrack: getCurrentAudioTrack,
      setAudioTrack: setAudioTrack,
      onAudioTracksChanged: onAudioTracksChanged
    };
  }

  return {
    create: create,
    isHls: isHls,
    networkTier: networkTier,
    estimateNetworkTier: estimateNetworkTier,
    qualityRank: qualityRank,
    rankedLinks: rankedLinks,
    chooseDefault: chooseDefault,
    fallbackFor: fallbackFor,
    supportsNativeHls: supportsNativeHls,
    hlsJsAvailable: hlsJsAvailable
  };
})();
