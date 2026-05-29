window.IS_TV_APP =
  navigator.userAgent.includes("Tizen") ||
  navigator.userAgent.includes("SMART-TV") ||
  window.location !== window.parent.location;

// Store items by a numeric key so we never put JSON inside onclick=""
var _cardItems = {};
var _cardCounter = 0;

function _storeItem(item) {
  var k = ++_cardCounter;
  _cardItems[k] = item;
  return k;
}

(async function () {
  var mainContent  = document.getElementById('mainContent');
  var tabBtns      = document.querySelectorAll('.tab-btn');
  var searchInput  = document.getElementById('searchInput');
  var currentTab   = 'movies';

  // ── TV Remote ──────────────────────────────────────────────────
  if (window.IS_TV_APP) {
    document.body.classList.add("tv-mode");
    document.addEventListener("keydown", function (e) {
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
    window.addEventListener("load", function () {
      var first = document.querySelector('[tabindex="0"]');
      if (first) first.focus();
    });
  }

  // ── Player helpers ─────────────────────────────────────────────
  function closePlayer() {
    var modal = document.getElementById('playerModal');
    var video = document.getElementById('playerVideo');
    if (video) { video.pause(); video.src = ''; }
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(function(){});
  }

  function showLoadingModal(title) {
    document.getElementById('playerStateLoading').hidden = false;
    document.getElementById('playerStateVideo').hidden   = true;
    document.getElementById('playerStateError').hidden   = true;
    document.getElementById('playerLoadingTitle').textContent = 'Resolving "' + title + '"…';
    document.getElementById('playerModal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function showVideoModal(links, title) {
    var video       = document.getElementById('playerVideo');
    var qualityList = document.getElementById('qualityList');
    document.getElementById('playerStateLoading').hidden = true;
    document.getElementById('playerStateVideo').hidden   = false;
    document.getElementById('playerStateError').hidden   = true;
    document.getElementById('playerTitle').textContent   = title;

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

  function showErrorModal(message) {
    document.getElementById('playerStateLoading').hidden = true;
    document.getElementById('playerStateVideo').hidden   = true;
    document.getElementById('playerStateError').hidden   = false;
    document.getElementById('playerErrorMsg').textContent = message;
  }

  // ── Main play handler ──────────────────────────────────────────
  window.openPlayerModal = async function (key, type) {
    var item  = _cardItems[key];
    if (!item) { console.error('Item not found for key', key); return; }
    var title = item.title || item.name || 'Unknown';
    var year  = (item.release_date || item.first_air_date || '').split('-')[0] || '';

    showLoadingModal(title);
    try {
      var links = await Resolver.resolve({ title: title, year: year, type: type });
      showVideoModal(links, title);
    } catch (err) {
      showErrorModal(err.message || 'Not found');
    }
  };

  document.getElementById('playerClose').addEventListener('click', closePlayer);
  document.getElementById('playerModal').addEventListener('click', function (e) {
    if (e.target === this) closePlayer();
  });
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePlayer();
  });

  // ── Cards ──────────────────────────────────────────────────────
  function createMovieCard(item, type) {
    var year   = (item.release_date || item.first_air_date || '').split('-')[0] || 'N/A';
    var poster = item.poster_path
      ? TMDB.IMG + item.poster_path
      : 'https://via.placeholder.com/200x300?text=No+Image';
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
    if (!items.length) return;
    var f = items[0];
    var k = _storeItem(f);
    var heroType = currentTab === 'tv' ? 'tv' : 'movie';
    document.getElementById('heroImage').style.backgroundImage =
      'url(\'' + (f.poster_path ? TMDB.IMG + f.poster_path : '') + '\')';
    document.getElementById('heroTitle').textContent       = f.title || f.name || 'Featured';
    document.getElementById('heroDescription').textContent =
      f.overview ? f.overview.substring(0, 150) + '…' : 'Stream now';
    document.getElementById('heroPlayBtn').onclick =
      function() { window.openPlayerModal(k, heroType); };
  }

  var sortByDate = function(arr) {
    return arr.slice().sort(function(a, b) {
      return (b.release_date || b.first_air_date || '') > (a.release_date || a.first_air_date || '') ? 1 : -1;
    });
  };

  async function loadMovies() {
    var results = await Promise.all([TMDB.moviesNowPlaying(), TMDB.moviesPopular(), TMDB.moviesTopRated()]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(results[0].results));
    mainContent.appendChild(createSection('Now Playing',  sortByDate(results[0].results).slice(0,12), 'movie'));
    mainContent.appendChild(createSection('Popular',      sortByDate(results[1].results).slice(0,12), 'movie'));
    mainContent.appendChild(createSection('Top Rated',    sortByDate(results[2].results).slice(0,12), 'movie'));
  }

  async function loadTV() {
    var results = await Promise.all([TMDB.tvAiringToday(), TMDB.tvPopular(), TMDB.tvTopRated()]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(results[0].results));
    mainContent.appendChild(createSection('Airing Today', sortByDate(results[0].results).slice(0,12), 'tv'));
    mainContent.appendChild(createSection('Popular',      sortByDate(results[1].results).slice(0,12), 'tv'));
    mainContent.appendChild(createSection('Top Rated',    sortByDate(results[2].results).slice(0,12), 'tv'));
  }

  async function renderContent(tab) {
    currentTab = tab;
    tabBtns.forEach(function(btn) { btn.classList.toggle('active', btn.dataset.tab === tab); });
    if (tab === 'movies') await loadMovies();
    else if (tab === 'tv') await loadTV();
  }

  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() { renderContent(btn.dataset.tab); });
  });

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
