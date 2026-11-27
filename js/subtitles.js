/* Subtitle providers and native-track manager for the Khemirix TV player.
 *
 * Providers are thin wrappers around the verified Showbox API routes. The
 * server owns the real MySubs / subtitles.website / SubDL / Wyzie Subs /
 * OpenSubtitles.com integrations and all credentials; the browser only picks
 * a provider, a language, and one of the ranked results. The UI shows exactly
 * four languages and never attaches a subtitle automatically.
 */
var Subtitles = (function () {
  var TIMEOUT_MS = 15000;
  var SIZE_KEY = 'ktv_sub_size';
  var BG_KEY = 'ktv_sub_bg';
  var PROVIDER_KEY = 'ktv_sub_provider';
  var LANG_KEY = 'ktv_sub_lang';
  var STYLE_ID = 'ktvSubtitleStyle';

  var LANGS = [
    { code: 'ar', label: 'Arabic 🇸🇦' },
    { code: 'fr', label: 'French 🇫🇷' },
    { code: 'en', label: 'English 🇬🇧' },
    { code: 'pl', label: 'Polish 🇵🇱' }
  ];

  var PROVIDERS = [
    { id: 'auto', label: 'Auto (best available)' },
    { id: 'mysubs', label: 'MySubs' },
    { id: 'subtitles-website', label: 'subtitles.website' },
    { id: 'subdl', label: 'SubDL' },
    { id: 'wyzie', label: 'Wyzie Subs' },
    { id: 'opensubtitles', label: 'OpenSubtitles.com' }
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

  function validLanguage(code) {
    return LANGS.some(function (lang) { return lang.code === code; });
  }

  function languageLabel(code) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === code) return LANGS[i].label;
    }
    return code;
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
        return { code: code, label: lang.label || languageLabel(code) };
      }).filter(function (lang) { return validLanguage(lang.code); });
    }
    if (validLanguage(subtitle.lang)) {
      return [{ code: subtitle.lang, label: languageLabel(subtitle.lang) }];
    }
    return [];
  }

  function languagesFromResults(results) {
    var items = Array.isArray(results) ? results : [];
    return LANGS.map(function (lang) {
      var count = items.filter(function (result) {
        return result && result.lang === lang.code;
      }).length;
      return { code: lang.code, label: lang.label, count: count };
    });
  }

  function bestForLanguage(results, code, limit) {
    var max = Math.max(1, Number(limit) || 3);
    var items = Array.isArray(results) ? results : [];
    return items.filter(function (result) {
      return result && validLanguage(code) && result.lang === code && result.url;
    }).slice(0, max);
  }

  function normalizeResult(raw) {
    if (!raw || !raw.url) return null;
    var code = null;
    if (raw.lang && validLanguage(raw.lang)) code = raw.lang;
    if (!code && Array.isArray(raw.languages) && raw.languages.length) {
      var candidate = raw.languages[0].code || raw.languages[0].lang;
      if (validLanguage(candidate)) code = candidate;
    }
    if (!code) return null;
    return {
      id: String(raw.id || (raw.provider || '') + ':' + (raw.name || raw.release || '')),
      provider: raw.provider || '',
      providerLabel: raw.providerLabel || raw.provider || '',
      name: raw.name || raw.release || languageLabel(code),
      release: raw.release || raw.name || '',
      lang: code,
      languages: [{ code: code, label: languageLabel(code) }],
      format: raw.format || 'srt',
      url: raw.url,
      score: Number(raw.score) || 0
    };
  }

  function emptySearch() {
    return { subtitle: null, results: [], languages: languagesFromResults([]), errors: [] };
  }

  function search(meta, providerId) {
    if (!meta || !meta.imdbId) return Promise.resolve(emptySearch());
    var q = new URLSearchParams();
    q.set('imdb', meta.imdbId);
    q.set('type', meta.type === 'tv' ? 'series' : (meta.type || 'movie'));
    if (meta.title) q.set('title', String(meta.title));
    if (q.get('type') === 'series') {
      if (meta.season) q.set('season', String(meta.season));
      if (meta.episode) q.set('episode', String(meta.episode));
    }
    q.set('provider', validProvider(providerId) ? providerId : 'auto');

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(base() + '/api/subtitles/search?' + q.toString(), {
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) return emptySearch();
      return res.json();
    }).then(function (data) {
      var raw = (data && Array.isArray(data.results)) ? data.results : [];
      if (!raw.length && data && data.subtitle) raw = [data.subtitle];
      var results = raw.map(normalizeResult).filter(function (result) { return !!result; });
      return {
        subtitle: normalizeResult(data && data.subtitle),
        results: results,
        languages: languagesFromResults(results),
        errors: (data && Array.isArray(data.errors)) ? data.errors : []
      };
    }).catch(function () {
      return emptySearch();
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
      language: validLanguage(options.language) ? options.language : storageGet(LANG_KEY, 'ar'),
      results: [],
      languages: languagesFromResults([]),
      choices: [],
      selectedId: '',
      subtitle: null
    };
    if (!validLanguage(state.language)) state.language = 'ar';

    function report(status, name) {
      state.status = status;
      state.name = name || state.name;
      if (onStatus) {
        try {
          onStatus(status, state.name, {
            languages: state.languages.slice(),
            choices: state.choices.slice(),
            selectedId: state.selectedId,
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
      track.label = subtitle.name || languageLabel(subtitle.lang);
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
      state.name = '';
      state.selectedId = '';
      state.subtitle = null;
      state.choices = [];
      report('loading');
      search(state.meta, state.provider).then(function (result) {
        if (!state.alive || token !== state.token || state.video !== video) return;
        state.results = result.results;
        state.languages = result.languages;
        // Step 1 only: expose language counts. The user must pick a language
        // and then one of its best three subtitles before anything downloads.
        state.choices = bestForLanguage(state.results, state.language, 3);
        report('none');
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
      if (!validLanguage(code)) return false;
      state.language = code;
      storageSet(LANG_KEY, code);
      state.choices = bestForLanguage(state.results, code, 3);
      detachTrack();
      state.subtitle = null;
      state.selectedId = '';
      state.name = '';
      report('none');
      return true;
    }

    function selectSubtitle(id) {
      var chosen = null;
      for (var i = 0; i < state.results.length; i++) {
        if (String(state.results[i].id) === String(id)) { chosen = state.results[i]; break; }
      }
      if (!chosen || !chosen.url) return false;
      createTrack(chosen);
      state.subtitle = chosen;
      state.selectedId = String(chosen.id);
      state.language = chosen.lang;
      storageSet(LANG_KEY, chosen.lang);
      report(state.enabled ? 'on' : 'off', chosen.name);
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
        choices: state.choices.slice(),
        selectedId: state.selectedId,
        name: state.name,
        subtitle: state.subtitle
      };
    }

    function destroy() {
      state.alive = false;
      state.token += 1;
      detachTrack();
      state.subtitle = null;
      state.results = [];
      state.languages = languagesFromResults([]);
      state.choices = [];
    }

    applyStyle();
    load();

    return {
      setEnabled: setEnabled,
      setProvider: setProvider,
      setLanguage: setLanguage,
      selectSubtitle: selectSubtitle,
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
    languagesFromResults: languagesFromResults,
    bestForLanguage: bestForLanguage,
    languages: LANGS.slice(),
    providers: PROVIDERS.slice(),
    sizes: Object.keys(SIZES),
    backgrounds: Object.keys(BACKGROUNDS),
    keys: { size: SIZE_KEY, background: BG_KEY, provider: PROVIDER_KEY, language: LANG_KEY }
  };
})();
