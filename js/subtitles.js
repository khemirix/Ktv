/* Arabic subtitles for the Ktv player.
   Subtitles are attached by default and follow the video timeline via
   native <track> cues. The player can turn them off with the toggle button. */
var Subtitles = (function () {
  var TIMEOUT_MS = 15000;

  function base() {
    var b = (window.Resolver && Resolver.getApiBase)
      ? Resolver.getApiBase()
      : 'https://showbox-api-1.onrender.com';
    return b.replace(/\/$/, '');
  }

  async function search(meta) {
    if (!meta || !meta.imdbId) return null;
    var q = new URLSearchParams();
    q.set('imdb', meta.imdbId);
    q.set('type', meta.type === 'tv' ? 'series' : (meta.type || 'movie'));
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
      return data && data.subtitle ? data.subtitle : null;
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function applyTracks(video, track, enabled) {
    if (!video.textTracks) return;
    for (var i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode =
        (enabled && video.textTracks[i] === track.track) ? 'showing' : 'disabled';
    }
  }

  function attach(video, meta, onStatus) {
    var state = { video: video, track: null, enabled: true, alive: true };

    function apply() { applyTracks(video, state.track, state.enabled); }

    onStatus && onStatus('loading');
    search(meta).then(function (sub) {
      if (!state.alive || state.video !== video) return;
      if (!sub) {
        onStatus && onStatus('none');
        return;
      }
      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'العربية';
      track.srclang = 'ar';
      track.default = true;
      track.src = base() + sub.url;
      video.appendChild(track);
      state.track = track;
      track.addEventListener('load', apply);
      track.addEventListener('error', function () {
        if (state.alive) onStatus && onStatus('none');
      });
      apply();
      onStatus && onStatus('on', sub.name);
    });

    return {
      setEnabled: function (on) {
        state.enabled = !!on;
        apply();
        onStatus && onStatus(state.enabled ? 'on' : 'off');
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

  return { attach: attach };
})();
