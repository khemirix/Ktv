window.IS_TV_APP =
  navigator.userAgent.includes("Tizen") ||
  navigator.userAgent.includes("SMART-TV") ||
  window.location !== window.parent.location;

var _cardItems   = {};
var _cardCounter = 0;
function _storeItem(item) { var k = ++_cardCounter; _cardItems[k] = item; return k; }

(async function () {
  var mainContent = document.getElementById('mainContent');
  var tabBtns     = document.querySelectorAll('.tab-btn');
  var searchInput = document.getElementById('searchInput');
  var currentTab  = 'movies';

  // current TV show context for the episode panel
  var _tvContext = null; // { title, year, tmdbId, seasons: [{season_number, episode_count}] }

  // ── TV Remote ────────────────────────────────────────────────────
  if (window.IS_TV_APP) {
    document.body.classList.add('tv-mode');
    document.addEventListener('keydown', function(e) {
      var focusable = Array.from(document.querySelectorAll('[tabindex="0"]:not([disabled])'));
      if (!focusable.length) return;
      var index = focusable.indexOf(document.activeElement);
      if (index === -1) { focusable[0].focus(); return; }
      switch (e.keyCode) {
        case 37: index = Math.max(0, index - 1); break;
        case 39: index = Math.min(focusable.length - 1, index + 1); break;
        case 38: index = Math.max(0, index - 5); break;
        case 40: index = Math.min(focusable.length - 1, index + 5); break;
        case 13: document.activeElement.click(); return;
        case 10009: closePlayer(); document.body.style.cursor = 'none'; return;
        default: return;
      }
      e.preventDefault();
      focusable[index].focus();
    });
    window.addEventListener('load', function() {
      var first = document.querySelector('[tabindex="0"]');
      if (first) first.focus();
    });
  }

  // ── Player helpers ───────────────────────────────────────────────
  function closePlayer() {
    var modal = document.getElementById('playerModal');
    var video = document.getElementById('playerVideo');
    if (video) { video.pause(); video.src = ''; }
    modal.classList.remove('active');
    document.body.style.overflow = '';
    _tvContext = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(function(){});
  }

  function setPlayerState(state) {
    document.getElementById('playerStateLoading').hidden = state !== 'loading';
    document.getElementById('playerStateVideo').hidden   = state !== 'video';
    document.getElementById('playerStateError').hidden   = state !== 'error';
  }

  function openModal() {
    document.getElementById('playerModal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // ── Load a video URL into the player ────────────────────────────
  function playLinks(links, title) {
    var video       = document.getElementById('playerVideo');
    var qualityList = document.getElementById('qualityList');
    var titleEl     = document.getElementById('playerTitle');

    titleEl.textContent = title || '';
    setPlayerState('video');

    qualityList.innerHTML = '';
    links.forEach(function(link, i) {
      var btn = document.createElement('button');
      btn.className = 'quality-btn' + (i === 0 ? ' active' : '');
      btn.textContent = link.quality || ('Link ' + (i + 1));
      btn.addEventListener('click', function() {
        video.src = link.url;
        video.play();
        qualityList.querySelectorAll('.quality-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
      qualityList.appendChild(btn);
    });

    video.src = links[0].url;
    video.play().catch(function(){});
  }

  // ── Episode panel ────────────────────────────────────────────────
  async function buildEpisodePanel(tmdbId, seasons) {
    var panel      = document.getElementById('episodePanel');
    var seasonTabs = document.getElementById('seasonTabs');
    var epList     = document.getElementById('episodeList');

    panel.hidden = false;
    seasonTabs.innerHTML = '';
    epList.innerHTML     = '<div class="ep-loading">Loading…</div>';

    // Build season tab buttons
    seasons.forEach(function(s, i) {
      var btn = document.createElement('button');
      btn.className   = 'season-tab' + (i === 0 ? ' active' : '');
      btn.textContent = 'S' + s.season_number;
      btn.addEventListener('click', function() {
        seasonTabs.querySelectorAll('.season-tab').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        loadEpisodes(tmdbId, s.season_number);
      });
      seasonTabs.appendChild(btn);
    });

    // Load season 1 by default
    if (seasons.length) loadEpisodes(tmdbId, seasons[0].season_number);
  }

  async function loadEpisodes(tmdbId, seasonNum) {
    var epList = document.getElementById('episodeList');
    epList.innerHTML = '<div class="ep-loading">Loading episodes…</div>';
    try {
      var data = await TMDB.getSeason(tmdbId, seasonNum);
      var episodes = (data && data.episodes) ? data.episodes : [];
      epList.innerHTML = '';
      episodes.forEach(function(ep) {
        var div = document.createElement('div');
        div.className = 'ep-item';
        var thumb = ep.still_path
          ? '<img src="https://image.tmdb.org/t/p/w185' + ep.still_path + '" class="ep-thumb" onerror="this.style.display=\'none\'">'
          : '<div class="ep-thumb ep-thumb-placeholder"></div>';
        div.innerHTML =
          thumb +
          '<div class="ep-info">' +
            '<div class="ep-num">S' + String(seasonNum).padStart(2,'0') + 'E' + String(ep.episode_number).padStart(2,'0') + '</div>' +
            '<div class="ep-name">' + (ep.name || 'Episode ' + ep.episode_number) + '</div>' +
          '</div>';
        div.addEventListener('click', function() {
          // Mark active
          epList.querySelectorAll('.ep-item').forEach(function(e) { e.classList.remove('active'); });
          div.classList.add('active');
          loadTVEpisode(seasonNum, ep.episode_number, ep.name);
        });
        epList.appendChild(div);
      });
    } catch(err) {
      epList.innerHTML = '<div class="ep-loading" style="color:#f87171">Failed to load episodes</div>';
    }
  }

  async function loadTVEpisode(season, episode, epName) {
    if (!_tvContext) return;
    var label = _tvContext.title + ' · S' + String(season).padStart(2,'0') + 'E' + String(episode).padStart(2,'0');
    // Show loading inside the player area without closing the whole modal
    document.getElementById('playerLoadingTitle').textContent = 'Loading ' + label + '…';
    setPlayerState('loading');
    try {
      var links = await Resolver.resolveEpisode({
        title:   _tvContext.title,
        year:    _tvContext.year,
        season:  season,
        episode: episode
      });
      playLinks(links, label);
    } catch(err) {
      setPlayerState('error');
      document.getElementById('playerErrorMsg').textContent = err.message || 'Not found';
    }
  }

  // ── Main play handler ────────────────────────────────────────────
  window.openPlayerModal = async function(key, type) {
    var item  = _cardItems[key];
    if (!item) return;
    var title = item.title || item.name || 'Unknown';
    var year  = (item.release_date || item.first_air_date || '').split('-')[0] || '';

    document.getElementById('playerLoadingTitle').textContent = 'Loading "' + title + '"…';
    document.getElementById('episodePanel').hidden = true;
    setPlayerState('loading');
    openModal();

    if (type === 'tv') {
      // Fetch TMDB season info + resolve S1E1 in parallel
      try {
        var details = await TMDB.getById(item.id);
        var seasons = (details && details.seasons)
          ? details.seasons.filter(function(s) { return s.season_number > 0; })
          : [];

        _tvContext = { title: title, year: year, tmdbId: item.id, seasons: seasons };

        // Build episode panel (async, non-blocking)
        buildEpisodePanel(item.id, seasons);

        // Resolve S1E1
        var links = await Resolver.resolveEpisode({ title: title, year: year, season: 1, episode: 1 });
        var epLabel = title + ' · S01E01';
        playLinks(links, epLabel);

        // Mark first episode active once panel loads
        setTimeout(function() {
          var first = document.querySelector('.ep-item');
          if (first) first.classList.add('active');
        }, 800);

      } catch(err) {
        setPlayerState('error');
        document.getElementById('playerErrorMsg').textContent = err.message || 'Not found';
      }
    } else {
      // Movie
      document.getElementById('episodePanel').hidden = true;
      try {
        var links = await Resolver.resolveMovie({ title: title, year: year });
        playLinks(links, title);
      } catch(err) {
        setPlayerState('error');
        document.getElementById('playerErrorMsg').textContent = err.message || 'Not found';
      }
    }
  };

  document.getElementById('playerClose').addEventListener('click', closePlayer);
  document.getElementById('playerModal').addEventListener('click', function(e) {
    if (e.target === this) closePlayer();
  });
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePlayer();
  });

  // ── Cards ────────────────────────────────────────────────────────
  function createMovieCard(item, type) {
    var year   = (item.release_date || item.first_air_date || '').split('-')[0] || 'N/A';
    var poster = item.poster_path ? TMDB.IMG + item.poster_path : 'https://via.placeholder.com/200x300?text=No+Image';
    var title  = (item.title || item.name || '').replace(/"/g, '&quot;');
    var k      = _storeItem(item);
    return '<div class="movie-card" tabindex="0" onclick="window.openPlayerModal(' + k + ',\'' + type + '\')">' +
      '<img src="' + poster + '" alt="' + title + '">' +
      '<div class="movie-card-overlay">' +
        '<div class="movie-card-title">' + (item.title || item.name) + '</div>' +
        '<div class="movie-card-info">' + year + '</div>' +
        '<div class="movie-card-actions">' +
          '<button class="btn-play-small" onclick="event.stopPropagation();window.openPlayerModal(' + k + ',\'' + type + '\')">' +
            '<i class="fas fa-play"></i> Play' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function createSection(title, items, type) {
    var section = document.createElement('div');
    section.className = 'content-section';
    section.innerHTML =
      '<h2 class="section-title">' + title + '</h2>' +
      '<div class="movie-grid">' + items.map(function(i) { return createMovieCard(i, type); }).join('') + '</div>';
    return section;
  }

async function setHeroContent(items) {
  if (!items || !items.length) return;

  const f = items[0];
  const k = _storeItem(f);

  const heroType =
    currentTab === 'tv' ? 'tv' :
    currentTab === 'anime' ? 'anime' :
    'movie';

  const heroImage = document.getElementById('heroImage');
  const heroTitle = document.getElementById('heroTitle');
  const heroDescription = document.getElementById('heroDescription');
  const heroPlayBtn = document.getElementById('heroPlayBtn');

  // Prefer backdrop over poster
  const imagePath =
    f.backdrop_path ||
    f.poster_path ||
    '';

  // Set image safely
  if (imagePath) {
    heroImage.style.backgroundImage =
      `url('${TMDB.IMG_ORIGINAL || TMDB.IMG}${imagePath}')`;
  } else {
    heroImage.style.backgroundImage = 'none';
  }

  // Title
  heroTitle.textContent =
    f.title ||
    f.name ||
    f.original_title ||
    'Featured';

  // Description
  let overview =
    f.overview ||
    'Watch now on KTV';

  if (overview.length > 180) {
    overview = overview.substring(0, 180) + '...';
  }

  heroDescription.textContent = overview;

  // Optional animation refresh
  heroImage.classList.remove('hero-fade');
  void heroImage.offsetWidth;
  heroImage.classList.add('hero-fade');

  // Play button
  heroPlayBtn.onclick = () => {
    window.openPlayerModal(k, heroType);
  };
}

  var sortByDate = function(arr) {
    return arr.slice().sort(function(a, b) {
      return (b.release_date || b.first_air_date || '') > (a.release_date || a.first_air_date || '') ? 1 : -1;
    });
  };

  async function loadMovies() {
    var r = await Promise.all([TMDB.moviesNowPlaying(), TMDB.moviesPopular(), TMDB.moviesTopRated()]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(r[0].results));
    mainContent.appendChild(createSection('Now Playing', sortByDate(r[0].results).slice(0,12), 'movie'));
    mainContent.appendChild(createSection('Popular',     sortByDate(r[1].results).slice(0,12), 'movie'));
    mainContent.appendChild(createSection('Top Rated',   sortByDate(r[2].results).slice(0,12), 'movie'));
  }

  async function loadTV() {
    var r = await Promise.all([TMDB.tvAiringToday(), TMDB.tvPopular(), TMDB.tvTopRated()]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(r[0].results));
    mainContent.appendChild(createSection('Airing Today', sortByDate(r[0].results).slice(0,12), 'tv'));
    mainContent.appendChild(createSection('Popular',      sortByDate(r[1].results).slice(0,12), 'tv'));
    mainContent.appendChild(createSection('Top Rated',    sortByDate(r[2].results).slice(0,12), 'tv'));
  }

  async function renderContent(tab) {
    currentTab = tab;
    tabBtns.forEach(function(btn) { btn.classList.toggle('active', btn.dataset.tab === tab); });
    if (tab === 'movies') await loadMovies();
    else if (tab === 'tv') await loadTV();
  }

  tabBtns.forEach(function(btn) { btn.addEventListener('click', function() { renderContent(btn.dataset.tab); }); });

  searchInput.addEventListener('keydown', async function(e) {
    if (e.key !== 'Enter') return;
    var q = searchInput.value.trim();
    if (!q) return;
    var res = await TMDB.search(q);
    mainContent.innerHTML = '';
    var items = res.results.filter(function(r) { return r.media_type !== 'person'; });
    var section = document.createElement('div');
    section.className = 'content-section';
    section.innerHTML =
      '<h2 class="section-title">Results for "' + q + '"</h2>' +
      '<div class="movie-grid">' + items.map(function(i) { return createMovieCard(i, i.media_type || 'movie'); }).join('') + '</div>';
    mainContent.appendChild(section);
  });

  renderContent('movies');
})();
