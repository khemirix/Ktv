window.IS_TV_APP =
  navigator.userAgent.includes("Tizen") ||
  navigator.userAgent.includes("SMART-TV") ||
  window.location !== window.parent.location;

var _cardItems = {};
var _cardCounter = 0;
function _storeItem(item) { var k = ++_cardCounter; _cardItems[k] = item; return k; }

(function () {
  var mainContent = document.getElementById('mainContent');
  var navButtons = Array.prototype.slice.call(document.querySelectorAll('.nav-tabs-custom .tab-btn'));
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('button.tab-btn[data-tab]'));
  var searchInput = document.getElementById('searchInput');

  var params = new URLSearchParams(window.location.search);
  var currentTab = params.get('tab') === 'tv' ? 'tv' : 'movies';

  var _subs = null;           // active subtitle controller
  var _player = null;         // active MediaPlayer controller
  var _imdbCache = {};        // tmdbId -> imdbId
  var _tvContext = null;      // active series context for the player panel
  var _detailsContext = null; // active details modal context
  var _detailsToken = 0;
  var _catalogToken = 0;
  var _searchToken = 0;
  var _searchTimer = null;
  var _searchState = { query: '', filter: 'all', results: [] };

  var NO_POSTER = 'https://placehold.co/400x600/1a1a1a/666666?text=No+Poster';

  var MOVIE_SECTIONS = [
    { title: 'Trending Movies', load: function () { return TMDB.trendingMovies(); } },
    { title: 'Popular Movies', load: function () { return TMDB.moviesPopular(); } },
    { title: 'Recently Added Movies', load: function () { return TMDB.moviesRecentlyAdded(); } },
    { title: 'Top Rated Movies', load: function () { return TMDB.moviesTopRated(); } },
    { title: 'Action Movies', load: function () { return TMDB.discoverMovies(28); } },
    { title: 'Comedy Movies', load: function () { return TMDB.discoverMovies(35); } },
    { title: 'Drama Movies', load: function () { return TMDB.discoverMovies(18); } },
    { title: 'Horror Movies', load: function () { return TMDB.discoverMovies(27); } },
    { title: 'Recommended Movies', load: function () { return TMDB.moviesRecommended(); } }
  ];

  var TV_SECTIONS = [
    { title: 'Trending TV Shows', load: function () { return TMDB.trendingTv(); } },
    { title: 'Popular Series', load: function () { return TMDB.tvPopular(); } },
    { title: 'Recently Added Series', load: function () { return TMDB.tvRecentlyAdded(); } },
    { title: 'Top Rated Series', load: function () { return TMDB.tvTopRated(); } },
    { title: 'Drama Series', load: function () { return TMDB.discoverTv(18); } },
    { title: 'Comedy Series', load: function () { return TMDB.discoverTv(35); } },
    { title: 'Anime', load: function () { return TMDB.tvAnime(); } },
    { title: 'Recommended Series', load: function () { return TMDB.tvRecommended(); } }
  ];

  // ── Small helpers ────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function yearOf(item) {
    return ((item && (item.release_date || item.first_air_date)) || '').split('-')[0] || 'N/A';
  }

  function typeOf(item) {
    return item && item.media_type === 'tv' ? 'tv' : 'movie';
  }

  function posterUrl(item) {
    return item && item.poster_path ? TMDB.IMG + item.poster_path : NO_POSTER;
  }

  function backdropUrl(item) {
    if (!item) return '';
    if (item.backdrop_path) return TMDB.IMG_HD + item.backdrop_path;
    return item.poster_path ? TMDB.IMG_HD + item.poster_path : '';
  }

  function updateBodyLock() {
    var playerModal = document.getElementById('playerModal');
    var detailsModal = document.getElementById('detailsModal');
    var locked = (playerModal && playerModal.classList.contains('active')) ||
                 (detailsModal && !detailsModal.hidden);
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  // ── TV remote navigation ────────────────────────────────────────
  if (window.IS_TV_APP) {
    document.body.classList.add('tv-mode');
    document.addEventListener('keydown', function (e) {
      var scope = document;
      var playerModal = document.getElementById('playerModal');
      var detailsModal = document.getElementById('detailsModal');
      if (playerModal && playerModal.classList.contains('active')) scope = playerModal;
      else if (detailsModal && !detailsModal.hidden) scope = detailsModal;

      var focusable = Array.prototype.slice.call(scope.querySelectorAll('[tabindex="0"]:not([disabled])'))
        .filter(function (el) { return el.offsetParent !== null; });
      if (!focusable.length) return;
      var index = focusable.indexOf(document.activeElement);
      if (index === -1) { focusable[0].focus(); return; }
      switch (e.keyCode) {
        case 37: index = Math.max(0, index - 1); break;
        case 39: index = Math.min(focusable.length - 1, index + 1); break;
        case 38: index = Math.max(0, index - 5); break;
        case 40: index = Math.min(focusable.length - 1, index + 5); break;
        case 13: document.activeElement.click(); return;
        case 10009: closePlayer(); closeDetails(); document.body.style.cursor = 'none'; return;
        default: return;
      }
      e.preventDefault();
      focusable[index].focus();
    });
    window.addEventListener('load', function () {
      var first = document.querySelector('[tabindex="0"]');
      if (first) first.focus();
    });
  }

  // ── Player helpers (quality / subtitles / fullscreen preserved) ──
  function setPlayerState(state) {
    document.getElementById('playerStateLoading').hidden = state !== 'loading';
    document.getElementById('playerStateVideo').hidden = state !== 'video';
    document.getElementById('playerStateError').hidden = state !== 'error';
  }

  function showPlaybackError(message) {
    var el = document.getElementById('playerErrorMsg');
    if (el) el.textContent = message;
    setPlayerState('error');
  }

  function openModal() {
    document.getElementById('playerModal').classList.add('active');
    updateBodyLock();
  }

  function closePlayer() {
    var modal = document.getElementById('playerModal');
    var video = document.getElementById('playerVideo');
    if (video) video._subToken = (video._subToken || 0) + 1;
    if (_player) { _player.destroy(); _player = null; }
    if (_subs) { _subs.destroy(); _subs = null; }
    closeSettingsMenu();
    modal.classList.remove('active');
    _tvContext = null;
    updateBodyLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  function setSubtitleButton(status, name) {
    var btn = document.getElementById('subtitleToggle');
    var menuBtn = document.getElementById('menuSubtitleToggle');
    var on = status === 'on';
    var disabled = (status === 'loading' || status === 'none');
    var text = status === 'loading' ? 'Arabic subtitles: Loading…'
      : status === 'none' ? 'Arabic subtitles: unavailable'
      : on ? 'Arabic subtitles: On' : 'Arabic subtitles: Off';

    if (btn) {
      btn.disabled = disabled;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = text;
    }
    if (menuBtn) {
      menuBtn.disabled = disabled;
      menuBtn.textContent = name ? text + ' · ' + name : text;
    }
  }

  function setQualityBadge(text) {
    var badge = document.getElementById('qualityBadge');
    if (badge) badge.textContent = text || '—';
  }

  function closeSettingsMenu() {
    var menu = document.getElementById('settingsMenu');
    if (menu) menu.hidden = true;
  }

  var SUB_STYLE_ID = 'ktvSubtitleStyle';
  var SUB_SIZES = { small: '0.9rem', medium: '1.15rem', large: '1.45rem', xlarge: '1.8rem' };
  var SUB_BGS = { none: 'transparent', dark: 'rgba(0,0,0,.65)', solid: '#000' };

  function applySubtitleStyle() {
    var size = localStorage.getItem('ktv_sub_size') || 'medium';
    var bg = localStorage.getItem('ktv_sub_bg') || 'dark';
    if (!SUB_SIZES[size]) size = 'medium';
    if (!SUB_BGS[bg]) bg = 'dark';

    var style = document.getElementById(SUB_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = SUB_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent =
      '#playerVideo::cue { direction: rtl; text-align: right; color: #fff;' +
      'font-size: ' + SUB_SIZES[size] + '; background: ' + SUB_BGS[bg] + '; }';

    document.querySelectorAll('#subtitleSizeOptions .settings-option').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-size') === size);
    });
    document.querySelectorAll('#subtitleBgOptions .settings-option').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-bg') === bg);
    });
  }

  async function subtitleMeta(opts) {
    opts = opts || {};
    var meta = {
      imdbId: opts.imdbId || null,
      type: opts.type || 'movie',
      season: opts.season,
      episode: opts.episode
    };
    if (!meta.imdbId && opts.tmdbId) {
      var cacheKey = meta.type + ':' + opts.tmdbId;
      if (!_imdbCache[cacheKey]) {
        _imdbCache[cacheKey] = await TMDB.getImdbId(meta.type, opts.tmdbId);
      }
      meta.imdbId = _imdbCache[cacheKey];
    }
    return meta;
  }

  function playLinks(links, title, opts) {
    var video = document.getElementById('playerVideo');
    var qualityList = document.getElementById('qualityList');
    var titleEl = document.getElementById('playerTitle');

    titleEl.textContent = title || '';
    setPlayerState('video');

    if (_subs) { _subs.destroy(); _subs = null; }
    var token = (video._subToken || 0) + 1;
    video._subToken = token;
    setSubtitleButton('loading');
    setQualityBadge(links[0] && links[0].quality ? links[0].quality : 'Auto');

    // ORG is a direct MP4; numbered qualities are HLS playlists. Keep one
    // direct URL as a safety net when an HLS playlist cannot be recovered.
    var fallbackUrl = '';
    for (var i = 0; i < links.length; i++) {
      if (!MediaPlayer.isHls(links[i].url)) { fallbackUrl = links[i].url; break; }
    }

    if (_player) _player.destroy();
    _player = MediaPlayer.create(video, {
      onError: function (message, fatal) {
        if (fatal) showPlaybackError(message);
        else console.warn('[Ktv player] ' + message);
      },
      onAutoplayBlocked: function () {
        // Native controls stay visible; the user can tap play manually.
      }
    });

    qualityList.innerHTML = '';
    links.forEach(function (link, i) {
      var label = link.quality || ('Link ' + (i + 1));
      var btn = document.createElement('button');
      btn.className = 'quality-btn' + (i === 0 ? ' active' : '');
      btn.textContent = label;
      btn.tabIndex = 0;
      btn.addEventListener('click', function () {
        _player.load(link.url, { fallbackUrl: (link.url === fallbackUrl) ? '' : fallbackUrl });
        if (_subs) _subs.resync();
        qualityList.querySelectorAll('.quality-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        setQualityBadge(label);
        closeSettingsMenu();
      });
      qualityList.appendChild(btn);
    });

    _player.load(links[0].url, {
      fallbackUrl: (links[0].url === fallbackUrl) ? '' : fallbackUrl
    });

    subtitleMeta(opts).then(function (meta) {
      if (video._subToken !== token) return;
      _subs = Subtitles.attach(video, meta, setSubtitleButton);
    });
  }

  // ── Season / episode rendering (shared by details + player panel) ─
  function renderSeasonTabs(container, seasons, onSelect, activeSeason) {
    if (!container) return;
    container.innerHTML = '';
    seasons.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'season-tab' + (s.season_number === activeSeason ? ' active' : '');
      btn.textContent = 'S' + String(s.season_number).padStart(2, '0');
      btn.tabIndex = 0;
      btn.addEventListener('click', function () {
        container.querySelectorAll('.season-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        onSelect(s.season_number);
      });
      container.appendChild(btn);
    });
  }

  function renderEpisodeList(container, episodes, season, onPlay, options) {
    if (!container) return;
    options = options || {};
    container.innerHTML = '';

    if (!episodes.length) {
      container.innerHTML = '<div class="ep-loading">No episodes found for this season.</div>';
      return;
    }

    episodes.forEach(function (ep) {
      var epNum = ep.episode_number;
      var title = ep.name || ('Episode ' + epNum);
      var runtime = ep.runtime ? ' · ' + escapeHtml(ep.runtime) + ' min' : '';
      var still = ep.still_path ? TMDB.IMG + ep.still_path : '';
      var row = document.createElement('div');
      row.className = options.compact ? 'ep-item' : 'detail-episode';
      row.tabIndex = 0;

      if (options.compact) {
        row.innerHTML =
          (still ? '<img class="ep-thumb" src="' + escapeHtml(still) + '" alt="" onerror="this.style.display=\'none\'">'
                 : '<div class="ep-thumb ep-thumb-placeholder"></div>') +
          '<div class="ep-info">' +
            '<div class="ep-num">S' + String(season).padStart(2, '0') + 'E' + String(epNum).padStart(2, '0') + '</div>' +
            '<div class="ep-name">' + escapeHtml(title) + '</div>' +
          '</div>';
      } else {
        row.innerHTML =
          (still ? '<img class="detail-ep-thumb" src="' + escapeHtml(still) + '" alt="" onerror="this.style.display=\'none\'">'
                 : '<div class="detail-ep-thumb detail-ep-thumb-empty"><i class="fas fa-film"></i></div>') +
          '<div class="detail-ep-body">' +
            '<div class="detail-ep-top">' +
              '<span class="detail-ep-num">E' + String(epNum).padStart(2, '0') + '</span>' +
              '<strong>' + escapeHtml(title) + '</strong>' +
            '</div>' +
            (ep.overview ? '<p>' + escapeHtml(ep.overview) + '</p>' : '') +
            '<div class="detail-ep-foot">' + escapeHtml(ep.air_date || '') + runtime + '</div>' +
          '</div>' +
          '<button type="button" class="detail-ep-play" tabindex="0" aria-label="Play ' + escapeHtml(title) + '">' +
            '<i class="fas fa-play"></i><span>Play</span>' +
          '</button>';
      }

      function activate() {
        onPlay(ep);
      }
      row.addEventListener('click', activate);
      var playBtn = row.querySelector('.detail-ep-play');
      if (playBtn) {
        playBtn.addEventListener('click', function (e) { e.stopPropagation(); activate(); });
      }
      container.appendChild(row);
    });
  }

  async function loadEpisodesInto(container, tmdbId, season, onPlay, options) {
    if (!container) return [];
    container.innerHTML = '<div class="ep-loading">Loading episodes…</div>';
    try {
      var data = await TMDB.getSeason(tmdbId, season);
      var episodes = (data && data.episodes) ? data.episodes : [];
      renderEpisodeList(container, episodes, season, onPlay, options);
      return episodes;
    } catch (err) {
      container.innerHTML = '<div class="ep-loading" style="color:#f87171">Failed to load episodes</div>';
      return [];
    }
  }

  async function loadPlayerEpisodes(tmdbId, season) {
    var list = document.getElementById('episodeList');
    var episodes = await loadEpisodesInto(list, tmdbId, season, function (ep) {
      playEpisode(season, ep.episode_number, ep.name);
    }, { compact: true });

    if (_tvContext) {
      _tvContext.episodes = episodes;
      Array.prototype.forEach.call(list.querySelectorAll('.ep-item'), function (row, i) {
        var ep = episodes[i];
        if (ep && _tvContext.currentSeason === season && _tvContext.currentEpisode === ep.episode_number) {
          row.classList.add('active');
        }
      });
    }
  }

  async function playEpisode(season, episode, epName) {
    if (!_tvContext) return;
    _tvContext.currentSeason = season;
    _tvContext.currentEpisode = episode;
    document.getElementById('playerLoadingTitle').textContent = 'Loading ' + _tvContext.title + ' · S' +
      String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0') + '…';
    setPlayerState('loading');
    try {
      var links = await Resolver.resolveEpisode({
        title: _tvContext.title,
        year: _tvContext.year,
        season: season,
        episode: episode
      });
      playLinks(links, _tvContext.title + ' · S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'), {
        type: 'tv', tmdbId: _tvContext.tmdbId, season: season, episode: episode
      });
    } catch (err) {
      showPlaybackError(err.message || 'Episode not found');
    }
  }

  // ── Playback entry point (movies + episodes) ────────────────────
  async function startPlayback(key, type, opts) {
    opts = opts || {};
    var item = _cardItems[key];
    if (!item) return;
    var title = item.title || item.name || 'Unknown';
    var year = yearOf(item);

    document.getElementById('playerLoadingTitle').textContent = 'Loading "' + title + '"…';
    document.getElementById('episodePanel').hidden = true;
    setPlayerState('loading');
    openModal();

    if (type === 'tv') {
      try {
        var details = opts.details || await TMDB.getById(item.id, 'tv');
        var seasons = (details && details.seasons) ? details.seasons : [];
        var season = opts.season || (seasons[0] && seasons[0].season_number) || 1;
        var episode = opts.episode || 1;

        _tvContext = {
          title: title, year: year, tmdbId: item.id,
          currentSeason: season, currentEpisode: episode, episodes: []
        };

        if (seasons.length) {
          var panel = document.getElementById('episodePanel');
          panel.hidden = false;
          renderSeasonTabs(document.getElementById('seasonTabs'), seasons, function (n) {
            loadPlayerEpisodes(item.id, n);
          }, season);
          loadPlayerEpisodes(item.id, season);
        }

        var links = await Resolver.resolveEpisode({
          title: title, year: year, season: season, episode: episode
        });
        playLinks(links, title + ' · S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'), {
          type: 'tv', tmdbId: item.id, season: season, episode: episode
        });
      } catch (err) {
        showPlaybackError(err.message || 'Episode not found');
      }
    } else {
      document.getElementById('episodePanel').hidden = true;
      try {
        var movieLinks = await Resolver.resolveMovie({ title: title, year: year });
        playLinks(movieLinks, title, { type: 'movie', tmdbId: item.id });
      } catch (err) {
        showPlaybackError(err.message || 'Movie not found');
      }
    }
  }

  window.openPlayerModal = startPlayback;

  // ── Details modal (movie + series metadata) ─────────────────────
  function closeDetails() {
    var modal = document.getElementById('detailsModal');
    if (!modal || modal.hidden) return;
    _detailsToken += 1;
    _detailsContext = null;
    modal.hidden = true;
    updateBodyLock();
  }

  function populateDetails(item, details, type) {
    var e = {
      backdrop: document.getElementById('detailsBackdrop'),
      poster: document.getElementById('detailsPoster'),
      type: document.getElementById('detailsType'),
      title: document.getElementById('detailsTitle'),
      meta: document.getElementById('detailsMeta'),
      genres: document.getElementById('detailsGenres'),
      overview: document.getElementById('detailsOverview'),
      episodes: document.getElementById('detailsEpisodesSection')
    };
    var src = details || item;

    var bg = backdropUrl(src);
    e.backdrop.style.backgroundImage = bg ? 'url("' + bg + '")' : 'none';
    e.poster.src = posterUrl(src);
    e.poster.alt = src.title || src.name || 'Poster';
    e.type.textContent = type === 'tv' ? 'TV SERIES' : 'MOVIE';
    e.title.textContent = src.title || src.name || 'Untitled';

    var meta = [];
    var year = yearOf(src);
    if (year !== 'N/A') meta.push(year);
    if (type === 'tv') {
      var seasons = (src.seasons && src.seasons.length) || src.number_of_seasons || 0;
      if (seasons) meta.push(seasons + (seasons === 1 ? ' Season' : ' Seasons'));
      if (src.runtime) meta.push(src.runtime + ' min episodes');
    } else if (src.runtime) {
      meta.push(src.runtime + ' min');
    }
    if (src.vote_average) meta.push('★ ' + Number(src.vote_average).toFixed(1));
    e.meta.textContent = meta.join('  •  ');

    e.genres.innerHTML = (src.genres || []).map(function (g) {
      return '<span class="genre-chip">' + escapeHtml(g.name || g) + '</span>';
    }).join('');

    e.overview.textContent = src.overview || 'No overview available for this title.';
    e.episodes.hidden = type !== 'tv';
  }

  async function loadDetailsEpisodes(season) {
    if (!_detailsContext) return;
    var ctx = _detailsContext;
    var list = document.getElementById('detailsEpisodeList');
    ctx.season = season;
    var episodes = await loadEpisodesInto(list, ctx.details.id, season, function (ep) {
      startPlayback(ctx.key, 'tv', {
        season: season,
        episode: ep.episode_number,
        details: ctx.details
      });
    }, { compact: false });
    ctx.episodes = episodes;
  }

  async function openDetails(key, type) {
    var item = _cardItems[key];
    if (!item) return;
    var token = ++_detailsToken;
    var modal = document.getElementById('detailsModal');

    populateDetails(item, null, type);
    document.getElementById('detailsEpisodeList').innerHTML = '<div class="ep-loading">Loading details…</div>';
    modal.hidden = false;
    updateBodyLock();

    try {
      var details = await TMDB.getById(item.id, type);
      if (token !== _detailsToken) return;
      if (!details) throw new Error('Details are unavailable for this title.');
      _detailsContext = { key: key, type: type, item: item, details: details, season: null, episodes: [] };
      populateDetails(item, details, type);

      if (type === 'tv') {
        var seasons = details.seasons || [];
        if (!seasons.length) throw new Error('No season information is available.');
        var firstSeason = seasons[0].season_number;
        renderSeasonTabs(document.getElementById('detailsSeasonTabs'), seasons, function (n) {
          loadDetailsEpisodes(n);
        }, firstSeason);
        await loadDetailsEpisodes(firstSeason);
      }
    } catch (err) {
      if (token !== _detailsToken) return;
      document.getElementById('detailsOverview').textContent = err.message || 'Could not load details.';
    }
  }

  window.openDetails = openDetails;

  document.getElementById('detailsPlayBtn').addEventListener('click', function () {
    var ctx = _detailsContext;
    if (!ctx) return;
    if (ctx.type === 'tv') {
      var season = ctx.season || (ctx.details.seasons[0] && ctx.details.seasons[0].season_number) || 1;
      var ep = ctx.episodes && ctx.episodes[0];
      startPlayback(ctx.key, 'tv', {
        season: season,
        episode: ep ? ep.episode_number : 1,
        details: ctx.details
      });
    } else {
      startPlayback(ctx.key, 'movie');
    }
  });

  document.getElementById('detailsClose').addEventListener('click', closeDetails);
  document.getElementById('detailsModal').addEventListener('click', function (e) {
    if (e.target === this) closeDetails();
  });

  // ── Shared poster component ─────────────────────────────────────
  function createPosterCard(item, type) {
    var key = _storeItem(item);
    var cardType = type === 'all' ? typeOf(item) : type;
    var label = cardType === 'tv' ? 'SERIES' : 'MOVIE';
    var title = escapeHtml(item.title || item.name || 'Untitled');
    return '<article class="poster-card" tabindex="0" role="button" aria-label="' + title + '" ' +
      'onclick="window.openDetails(' + key + ',\'' + cardType + '\')">' +
      '<div class="poster-skeleton"></div>' +
      '<img src="' + escapeHtml(posterUrl(item)) + '" alt="' + title + '" loading="lazy" ' +
        'onload="this.parentElement.classList.add(\'is-loaded\')" ' +
        'onerror="this.parentElement.classList.add(\'is-loaded\');this.src=\'' + NO_POSTER + '\'">' +
      '<span class="poster-type">' + label + '</span>' +
      '<span class="poster-year">' + escapeHtml(yearOf(item)) + '</span>' +
      '<div class="poster-overlay">' +
        '<h3>' + title + '</h3>' +
        '<button type="button" class="poster-play" tabindex="0" ' +
          'onclick="event.stopPropagation();window.openDetails(' + key + ',\'' + cardType + '\')">' +
          '<i class="fas fa-play"></i> Details' +
        '</button>' +
      '</div>' +
    '</article>';
  }

  function createSkeletonSection(title) {
    var section = document.createElement('section');
    section.className = 'content-section';
    var cards = '';
    for (var i = 0; i < 8; i++) cards += '<div class="poster-card is-skeleton"><div class="poster-skeleton"></div></div>';
    section.innerHTML = '<div class="section-heading"><h2>' + escapeHtml(title) + '</h2></div>' +
      '<div class="poster-rail">' + cards + '</div>';
    return section;
  }

  function createSection(title, items, type) {
    var section = document.createElement('section');
    section.className = 'content-section';
    section.innerHTML =
      '<div class="section-heading">' +
        '<div><h2>' + escapeHtml(title) + '</h2><span class="section-count">' + items.length + ' titles</span></div>' +
        '<div class="rail-arrows">' +
          '<button type="button" class="rail-arrow" data-dir="left" tabindex="0" aria-label="Scroll left"><i class="fas fa-chevron-left"></i></button>' +
          '<button type="button" class="rail-arrow" data-dir="right" tabindex="0" aria-label="Scroll right"><i class="fas fa-chevron-right"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="poster-rail">' +
        (items.length ? items.map(function (i) { return createPosterCard(i, type); }).join('')
                      : '<div class="rail-empty">Nothing available in this category right now.</div>') +
      '</div>';

    var rail = section.querySelector('.poster-rail');
    section.querySelectorAll('.rail-arrow').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var amount = Math.max(240, rail.clientWidth * 0.8);
        rail.scrollBy({ left: btn.dataset.dir === 'left' ? -amount : amount, behavior: 'smooth' });
      });
    });
    return section;
  }

  async function setHeroContent(items, type) {
    if (!items || !items.length) return;
    var f = items[0];
    var key = _storeItem(f);
    var heroImage = document.getElementById('heroImage');
    var heroTitle = document.getElementById('heroTitle');
    var heroDescription = document.getElementById('heroDescription');
    var heroPlayBtn = document.getElementById('heroPlayBtn');

    var bg = backdropUrl(f);
    heroImage.style.backgroundImage = bg ? 'url("' + bg + '")' : 'none';
    heroTitle.textContent = f.title || f.name || 'Featured';
    heroDescription.textContent = f.overview || 'Watch now';
    heroPlayBtn.onclick = function () { openDetails(key, type); };
  }

  function setHeroLoading() {
    document.getElementById('heroImage').style.backgroundImage = 'none';
    document.getElementById('heroTitle').textContent = 'Loading ' + (currentTab === 'tv' ? 'series' : 'movies') + '…';
    document.getElementById('heroDescription').textContent = 'Preparing your personalized catalog.';
    document.getElementById('heroPlayBtn').onclick = null;
  }

  // ── Catalog rendering ───────────────────────────────────────────
  async function renderContent(tab) {
    currentTab = tab;
    _searchState.query = '';
    navButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    try {
      if (tab === 'tv') history.replaceState(null, '', '?tab=tv');
      else history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      // file:// pages can reject history updates; navigation still works.
    }

    var sections = tab === 'tv' ? TV_SECTIONS : MOVIE_SECTIONS;
    var token = ++_catalogToken;
    setHeroLoading();
    mainContent.innerHTML = '';
    sections.forEach(function (s) { mainContent.appendChild(createSkeletonSection(s.title)); });

    var results = await Promise.all(sections.map(async function (s) {
      try {
        var data = await s.load();
        return (data.results || []).slice(0, 14);
      } catch (err) {
        console.warn('[Ktv catalog] ' + s.title + ': ' + err.message);
        return [];
      }
    }));

    if (token !== _catalogToken) return;
    setHeroContent(results[0], tab);
    mainContent.innerHTML = '';
    sections.forEach(function (s, i) {
      mainContent.appendChild(createSection(s.title, results[i], tab));
    });
  }

  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { renderContent(btn.dataset.tab); });
  });

  // ── Search across movies + series with type filtering ──────────
  function renderSearchResults() {
    var query = _searchState.query;
    var filter = _searchState.filter;
    var items = _searchState.results.filter(function (item) {
      if (filter === 'all') return true;
      return typeOf(item) === filter;
    });

    var typeLabel = filter === 'all' ? 'Movies & TV' : (filter === 'tv' ? 'TV Series' : 'Movies');
    mainContent.innerHTML = '';
    var section = createSection('Results for “' + query + '” · ' + typeLabel, items.slice(0, 40), 'all');
    var rail = section.querySelector('.poster-rail');
    rail.classList.remove('poster-rail');
    rail.classList.add('poster-grid');
    section.querySelectorAll('.rail-arrow').forEach(function (b) { b.hidden = true; });
    mainContent.appendChild(section);
  }

  function showSearchSkeleton() {
    setHeroLoading();
    mainContent.innerHTML = '';
    mainContent.appendChild(createSkeletonSection('Searching…'));
  }

  async function runSearch() {
    var q = searchInput.value.trim();
    if (!q) { renderContent(currentTab); return; }
    var token = ++_searchToken;
    _searchState.query = q;
    showSearchSkeleton();
    try {
      var res = await TMDB.search(q);
      if (token !== _searchToken) return;
      _searchState.results = (res.results || []).filter(function (r) {
        return typeOf(r) === 'movie' || typeOf(r) === 'tv';
      });
      renderSearchResults();
    } catch (err) {
      if (token !== _searchToken) return;
      mainContent.innerHTML = '<div class="search-error">Search failed: ' + escapeHtml(err.message) + '</div>';
    }
  }

  searchInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    clearTimeout(_searchTimer);
    runSearch();
  });
  searchInput.addEventListener('input', function () {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(runSearch, 400);
  });

  document.querySelectorAll('.search-filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.search-filter').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _searchState.filter = btn.dataset.filter;
      if (_searchState.query) renderSearchResults();
    });
  });

  document.getElementById('searchClear').addEventListener('click', function () {
    searchInput.value = '';
    _searchState.query = '';
    document.querySelectorAll('.search-filter').forEach(function (b) {
      b.classList.toggle('active', b.dataset.filter === 'all');
    });
    _searchState.filter = 'all';
    renderContent(currentTab);
  });

  // ── Player controls / subtitle settings ────────────────────────
  function toggleSubtitles() {
    if (!_subs) return;
    var btn = document.getElementById('subtitleToggle');
    _subs.setEnabled(btn.getAttribute('aria-pressed') !== 'true');
  }

  document.getElementById('subtitleToggle').addEventListener('click', toggleSubtitles);
  document.getElementById('menuSubtitleToggle').addEventListener('click', toggleSubtitles);

  var settingsBtn = document.getElementById('playerSettingsBtn');
  settingsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var menu = document.getElementById('settingsMenu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('settingsMenu');
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || settingsBtn.contains(e.target)) return;
    menu.hidden = true;
  });

  document.querySelectorAll('#subtitleSizeOptions .settings-option').forEach(function (b) {
    b.addEventListener('click', function () {
      localStorage.setItem('ktv_sub_size', b.getAttribute('data-size'));
      applySubtitleStyle();
    });
  });
  document.querySelectorAll('#subtitleBgOptions .settings-option').forEach(function (b) {
    b.addEventListener('click', function () {
      localStorage.setItem('ktv_sub_bg', b.getAttribute('data-bg'));
      applySubtitleStyle();
    });
  });
  applySubtitleStyle();

  document.getElementById('playerClose').addEventListener('click', closePlayer);
  document.getElementById('playerModal').addEventListener('click', function (e) {
    if (e.target === this) closePlayer();
  });

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var menu = document.getElementById('settingsMenu');
    if (menu && !menu.hidden) { menu.hidden = true; return; }
    var playerModal = document.getElementById('playerModal');
    var detailsModal = document.getElementById('detailsModal');
    if (playerModal.classList.contains('active')) { closePlayer(); return; }
    if (detailsModal && !detailsModal.hidden) closeDetails();
  });

  renderContent(currentTab);
})();
