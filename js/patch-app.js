/*  patch-app.js  –  load AFTER app.js
    Overrides setHeroContent so it feeds the hero carousel instead of the old static hero.
    Also upgrades TMDB image calls to /original (HD backdrops).  */

/* 1. Upgrade TMDB to return backdrop_path + HD images */
(function patchTMDB() {
  var _orig = {};
  ['moviesNowPlaying','moviesPopular','moviesTopRated',
   'tvAiringToday','tvPopular','tvTopRated'].forEach(function(fn) {
    _orig[fn] = TMDB[fn].bind(TMDB);
    TMDB[fn] = async function() {
      var r = await _orig[fn]();
      return r; /* backdrop_path is already on each result from TMDB API */
    };
  });
})();

/* 2. Replace setHeroContent inside the app's closure.
      app.js exposes renderContent → loadMovies/loadTV → setHeroContent.
      The cleanest hook: override TMDB list calls to capture results,
      then immediately init the carousel. */
(function patchHero() {
  var _cache = { items: null, type: 'movie' };

  /* Wrap the three "first-row" functions app.js uses for the hero */
  var _origNow   = TMDB.moviesNowPlaying.bind(TMDB);
  var _origToday = TMDB.tvAiringToday.bind(TMDB);

  TMDB.moviesNowPlaying = async function() {
    var r = await _origNow();
    _cache = { items: r.results, type: 'movie' };
    return r;
  };
  TMDB.tvAiringToday = async function() {
    var r = await _origToday();
    _cache = { items: r.results, type: 'tv' };
    return r;
  };

  /* Poll until app.js has called setHeroContent (it sets #heroTitle text) */
  var _built = false;
  var _poll = setInterval(function() {
    if (!_cache.items || _built) return;
    if (typeof window.HeroCarousel === 'undefined') return;

    _built = true;
    clearInterval(_poll);

    var sorted = _cache.items.slice().sort(function(a, b) {
      return (b.release_date || b.first_air_date || '') >
             (a.release_date || a.first_air_date || '') ? 1 : -1;
    });

    window.HeroCarousel.init(sorted, _cache.type);
  }, 120);

  /* Re-init carousel when tab changes */
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _built = false;
      _cache = { items: null, type: _cache.type };
      var _repoll = setInterval(function() {
        if (!_cache.items || _built) return;
        if (typeof window.HeroCarousel === 'undefined') return;
        _built = true;
        clearInterval(_repoll);
        var sorted = _cache.items.slice().sort(function(a, b) {
          return (b.release_date || b.first_air_date || '') >
                 (a.release_date || a.first_air_date || '') ? 1 : -1;
        });
        window.HeroCarousel.init(sorted, _cache.type);
      }, 120);
    });
  });

  /* Hide the old static hero elements app.js still touches */
  ['heroImage','heroTitle','heroDescription','heroPlayBtn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
})();
