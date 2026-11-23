/* Subtitle providers and native-track manager for the Khemirix TV player.
 *
 * Providers are thin wrappers around the verified Showbox API routes. The
 * server owns the real MySubs / subtitles.website integrations; the browser
 * only chooses which integration to call. Languages always come from the
 * provider response, never from a hardcoded list.
 */
var Subtitles = (function () {
  var TIMEOUT_MS = 15000;
  var SIZE_KEY = 'ktv_sub_size';
  var BG_KEY = 'ktv_sub_bg';
  var PROVIDER_KEY = 'ktv_sub_provider';
  var LANG_KEY = 'ktv_sub_lang';
  var STYLE_ID = 'ktvSubtitleStyle';

  var PROVIDERS = [
    { id: 'auto', label: 'Auto (best available)' },
    { id: 'mysubs', label: 'MySubs' },
    { id: 'subtitles-website', label: 'subtitles.website' }
  ];
  var SIZES = { small: '0.9rem', medium: '1.15rem', large: '1.45rem', xlarge: '1.8rem' };
  var BACKGROUNDS = { none: 'transparent', dark: 'rgba(0,0,0,.65)', solid: '#000' };

  function base() {
    var b = (window.Resolver && Resolver.getApiBase)
      ? Resolver.getApiBase()
      : 'https://showbox-api-1.onrender.com';
    return String(b).replace(/\/$/, '');
  }

  function storageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function validProvider(id) {
    return PROVIDERS.some(function (p) { return p.id === id; });
  }

  // Applies cue styling with CSS variables so the UI only changes two values.
  function applyStyle() {
    var size = storageGet(SIZE_KEY, 'medium');
    var bg = storageGet(BG_KEY, 'dark');
    if (!SIZES[size]) size = 'medium';
    if (!BACKGROUNDS[bg]) bg = 'dark';

    var root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty('--pv-sub-size', SIZES[size]);
      root.style.setProperty('--pv-sub-bg', BACKGROUNDS[bg]);
    }

    var style = document.getElementById(STYLE_ID);
    if (!style && document.head && document.head.appendChild) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    if (style) {
      style.textContent =
        '#playerVideo::cue { direction: rtl; text-align: right; color: #fff;' +
        'font-size: ' + SIZES[size] + '; background: ' + BACKGROUNDS[bg] + ';' +
        'text-shadow: 0 1px 3px rgba(0,0,0,.9); }';
    }
    return { size: size, background: bg };
  }

  function languagesOf(subtitle) {
    if (!subtitle) return [];
    if (Array.isArray(subtitle.languages) && subtitle.languages.length) {
      return subtitle.languages.map(function (lang) {
        var code = lang.code || lang.lang || '';
        return {
          code: code,
          label: lang.label || (code === 'ar' ? 'العربية' : code)
        };
      }).filter(function (lang) { return !!lang.code; });
    }
    if (subtitle.lang) {
      return [{ code: subtitle.lang, label: subtitle.lang === 'ar' ? 'العربية' : subtitle.lang }];
    }
    return [];
  }

  function search(meta, providerId) {
    if (!meta || !meta.imdbId) return Promise.resolve({ subtitle: null, languages: [] });
    var q = new URLSearchParams();
    q.set('imdb', meta.imdbId);
    q.set('type', meta.type === 'tv' ? 'series' : (meta.type || 'movie'));
    if (q.get('type') === 'series') {
      if (meta.season) q.set('season', String(meta.season));
      if (meta.episode) q.set('episode', String(meta.episode));
    }
    var provider = validProvider(providerId) ? providerId : 'auto';
    q.set('provider', provider);

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(base() + '/api/subtitles/search?' + q.toString(), {
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) return { subtitle: null, languages: [] };
      return res.json();
    }).then(function (data) {
      var subtitle = data && data.subtitle ? data.subtitle : null;
      return { subtitle: subtitle, languages: languagesOf(subtitle) };
    }).catch(function () {
      return { subtitle: null, languages: [] };
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function attach(video, meta, onStatus, options) {
    options = options || {};
    var state = {
      video: video,
      meta: meta || {},
      track: null,
      alive: true,
      token: 0,
      status: 'loading',
      name: '',
      enabled: options.enabled !== false,
      provider: validProvider(options.provider) ? options.provider : storageGet(PROVIDER_KEY, 'auto'),
      language: options.language || storageGet(LANG_KEY, 'ar'),
      subtitle: null,
      languages: []
    };

    function report(status, name) {
      state.status = status;
      state.name = name || state.name;
      if (onStatus) {
        try {
          onStatus(status, state.name, {
            languages: state.languages.slice(),
            provider: state.provider,
            language: state.language
          });
        } catch (e) {}
      }
    }

    function apply() {
      if (!video.textTracks) return;
      for (var i = 0; i < video.textTracks.length; i++) {
        var active = state.enabled && state.track && video.textTracks[i] === state.track.track;
        try { video.textTracks[i].mode = active ? 'showing' : 'disabled'; } catch (e) {}
      }
    }

    function detachTrack() {
      if (state.track && state.track.parentNode) {
        state.track.parentNode.removeChild(state.track);
      }
      state.track = null;
    }

    function createTrack(subtitle) {
      detachTrack();
      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subtitle.name || 'العربية';
      track.srclang = subtitle.lang || 'ar';
      track.default = true;
      track.src = base() + subtitle.url;
      video.appendChild(track);
      state.track = track;
      track.addEventListener('load', apply);
      track.addEventListener('error', function () {
        if (state.alive) report('none');
      });
      apply();
    }

    function load() {
      var token = ++state.token;
      report('loading');
      search(state.meta, state.provider).then(function (result) {
        if (!state.alive || token !== state.token || state.video !== video) return;
        state.subtitle = result.subtitle;
        state.languages = result.languages;
        if (!result.subtitle || !result.subtitle.url) {
          report('none');
          return;
        }
        if (!state.languages.some(function (l) { return l.code === state.language; })) {
          state.language = state.languages.length ? state.languages[0].code : '';
          if (state.language) storageSet(LANG_KEY, state.language);
        }
        createTrack(result.subtitle);
        report(state.enabled ? 'on' : 'off', result.subtitle.name);
      });
    }

    function setEnabled(on) {
      state.enabled = !!on;
      apply();
      report(state.enabled && state.subtitle ? 'on' : (state.subtitle ? 'off' : 'none'));
    }

    function setProvider(id) {
      if (!validProvider(id) || id === state.provider) return;
      state.provider = id;
      storageSet(PROVIDER_KEY, id);
      detachTrack();
      load();
    }

    function setLanguage(code) {
      var found = state.languages.some(function (l) { return l.code === code; });
      if (!found) return false;
      state.language = code;
      storageSet(LANG_KEY, code);
      return true;
    }

    // Re-apply cue modes after a quality/source change. Reactivating the text
    // track forces the browser to re-read the cues against the new timeline.
    function resync() {
      if (!state.track || !video.textTracks) return;
      for (var i = 0; i < video.textTracks.length; i++) {
        try { video.textTracks[i].mode = 'disabled'; } catch (e) {}
      }
      apply();
    }

    function forceReload() {
      if (!state.track) return;
      var src = state.track.getAttribute('src');
      if (!src) return;
      state.track.setAttribute('src', src + (src.indexOf('?') === -1 ? '?' : '&') + '_ktv=' + Date.now());
      resync();
    }

    function getState() {
      return {
        status: state.status,
        enabled: state.enabled,
        provider: state.provider,
        language: state.language,
        languages: state.languages.slice(),
        name: state.name,
        subtitle: state.subtitle
      };
    }

    function destroy() {
      state.alive = false;
      state.token += 1;
      detachTrack();
      state.subtitle = null;
      state.languages = [];
    }

    applyStyle();
    load();

    return {
      setEnabled: setEnabled,
      setProvider: setProvider,
      setLanguage: setLanguage,
      setSize: function (size) { if (SIZES[size]) { storageSet(SIZE_KEY, size); applyStyle(); } },
      setBackground: function (bg) { if (BACKGROUNDS[bg]) { storageSet(BG_KEY, bg); applyStyle(); } },
      resync: resync,
      forceReload: forceReload,
      getState: getState,
      destroy: destroy
    };
  }

  applyStyle();

  return {
    attach: attach,
    search: search,
    applyStyle: applyStyle,
    languagesOf: languagesOf,
    providers: PROVIDERS.slice(),
    sizes: Object.keys(SIZES),
    backgrounds: Object.keys(BACKGROUNDS),
    keys: { size: SIZE_KEY, background: BG_KEY, provider: PROVIDER_KEY, language: LANG_KEY }
  };
})();
