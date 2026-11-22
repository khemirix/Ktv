/* Subtitles for the Ktv player.
 *
 * Subtitle discovery and rendering are kept separate from media playback.
 * The API currently resolves Arabic subtitles through multiple free providers
 * server-side; this module consumes a provider-agnostic descriptor so a
 * language/provider picker can be added later without touching the player.
 *
 * Subtitles are attached by default and follow the video timeline via native
 * <track> cues. The player can turn them off with the toggle button. */
var Subtitles = (function () {
  var TIMEOUT_MS = 15000;

  var CONFIG = {
    lang: 'ar',
    providers: ['mysubs', 'subtitles-website']
  };

  function base() {
    var b = (window.Resolver && Resolver.getApiBase)
      ? Resolver.getApiBase()
      : 'https://showbox-api-1.onrender.com';
    return b.replace(/\/$/, '');
  }

  function normalizeSubtitle(sub) {
    if (!sub || !sub.url) return null;
    return {
      url: sub.url,
      name: sub.name || 'Subtitles',
      lang: sub.lang || CONFIG.lang,
      provider: sub.provider || ''
    };
  }

  // Provider-agnostic discovery. Returns null when no subtitle is available.
  async function find(meta) {
    if (!meta || !meta.imdbId) return null;
    var q = new URLSearchParams();
    q.set('imdb', meta.imdbId);
    q.set('type', meta.type === 'tv' ? 'series' : (meta.type || 'movie'));
    q.set('lang', CONFIG.lang);
    if (q.get('type') === 'series') {
      if (meta.season) q.set('season', String(meta.season));
      if (meta.episode) q.set('episode', String(meta.episode));
    }

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    try {
      var res = await fetch(base() + '/api/subtitles/search?' + q.toString(), {
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) return null;
      var data = await res.json();
      return normalizeSubtitle(data && data.subtitle);
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function trackLabel(sub) {
    if (sub.lang === 'ar') return 'العربية';
    return String(sub.lang || '').toUpperCase() || 'Subtitles';
  }

  function applyTracks(video, track, enabled) {
    if (!video.textTracks) return;
    for (var i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode =
        (enabled && video.textTracks[i] === track.track) ? 'showing' : 'disabled';
    }
  }

  function attach(video, meta, onStatus) {
    var state = { video: video, track: null, name: '', enabled: true, alive: true };

    function apply() { applyTracks(video, state.track, state.enabled); }

    onStatus && onStatus('loading');
    find(meta).then(function (sub) {
      if (!state.alive || state.video !== video) return;
      if (!sub) {
        onStatus && onStatus('none');
        return;
      }

      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = trackLabel(sub);
      track.srclang = sub.lang;
      track.default = true;
      track.src = base() + sub.url;
      video.appendChild(track);

      state.track = track;
      state.name = sub.name;
      track.addEventListener('load', apply);
      track.addEventListener('error', function () {
        if (state.alive) onStatus && onStatus('none');
      });
      apply();
      onStatus && onStatus('on', state.name);
    });

    return {
      setEnabled: function (on) {
        state.enabled = !!on;
        apply();
        onStatus && onStatus(state.enabled ? 'on' : 'off', state.name);
      },
      resync: apply,
      destroy: function () {
        state.alive = false;
        if (state.track && state.track.parentNode) {
          state.track.parentNode.removeChild(state.track);
        }
        state.track = null;
      }
    };
  }

  function configure(options) {
    options = options || {};
    if (options.lang) CONFIG.lang = options.lang;
    if (Array.isArray(options.providers)) CONFIG.providers = options.providers.slice();
  }

  return {
    configure: configure,
    find: find,
    attach: attach
  };
})();
