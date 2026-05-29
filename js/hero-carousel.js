/* ─────────────────────────────────────────────────────────────────
   HERO CAROUSEL  –  drop-in replacement for setHeroContent()
   Requires: TMDB (tmdb.js), _storeItem(), openPlayerModal() from app.js
   Usage: call window.HeroCarousel.init(items, type) instead of setHeroContent()
   ───────────────────────────────────────────────────────────────── */

window.HeroCarousel = (function () {

  /* ── CONFIG ──────────────────────────────────────────────────── */
  var SLIDE_DURATION = 7000;   // ms per slide
  var MAX_SLIDES     = 6;
  var TMDB_IMG       = 'https://image.tmdb.org/t/p/original';

  /* ── STATE ───────────────────────────────────────────────────── */
  var slides   = [];
  var dotBtns  = [];
  var current  = 0;
  var autoTimer   = null;
  var progTimer   = null;

  /* ── DOM REFS (created once on first init) ───────────────────── */
  var container  = null;   // the hero wrapper div
  var dotsEl     = null;
  var progBar    = null;

  /* ── Build hero DOM once ─────────────────────────────────────── */
  function ensureContainer() {
    if (container) return;

    /* Replace whatever is in #heroSection with our structure */
    var heroSection = document.getElementById('heroSection');
    heroSection.innerHTML = '';
    heroSection.style.cssText =
      'position:relative;height:88vh;min-height:540px;overflow:hidden;';

    container = heroSection;

    /* Dots row */
    dotsEl = document.createElement('div');
    dotsEl.style.cssText =
      'position:absolute;bottom:1.8rem;left:3.5rem;z-index:10;' +
      'display:flex;gap:0.45rem;align-items:center;';
    container.appendChild(dotsEl);

    /* Progress bar */
    progBar = document.createElement('div');
    progBar.style.cssText =
      'position:absolute;bottom:0;left:0;height:2px;' +
      'background:#e50914;z-index:10;width:0%;transition:none;';
    container.appendChild(progBar);
  }

  /* ── Create one slide element ────────────────────────────────── */
  function makeSlide(item, type) {
    var backdrop = item.backdrop_path
      ? TMDB_IMG + item.backdrop_path
      : (item.poster_path ? TMDB_IMG + item.poster_path : '');

    var title  = (item.title || item.name || '').replace(/</g,'&lt;');
    var year   = (item.release_date || item.first_air_date || '').slice(0, 4);
    var rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : '';
    var desc   = item.overview ? item.overview.slice(0, 200) + '…' : '';
    var label  = type === 'tv' ? 'TV Show' : 'Movie';
    var key    = window._storeItem(item);

    var slide = document.createElement('div');
    slide.style.cssText =
      'position:absolute;inset:0;opacity:0;transition:opacity 1.1s ease;pointer-events:none;';

    slide.innerHTML =
      /* HD backdrop */
      '<div style="position:absolute;inset:0;' +
        'background:url(\'' + backdrop + '\') center/cover no-repeat;' +
        'transition:transform 10s ease;">' +
        /* Gradients */
        '<div style="position:absolute;inset:0;background:' +
          'linear-gradient(to right,rgba(0,0,0,.88) 0%,rgba(0,0,0,.5) 40%,transparent 75%),' +
          'linear-gradient(to top ,rgba(0,0,0,1) 0% ,rgba(0,0,0,.5) 28%,transparent 55%);">' +
        '</div>' +
      '</div>' +

      /* Content */
      '<div style="position:absolute;bottom:5rem;left:3.5rem;z-index:2;max-width:520px;">' +

        /* Badge */
        '<div style="display:inline-flex;align-items:center;gap:.4rem;' +
          'background:rgba(229,9,20,.18);border:1px solid rgba(229,9,20,.4);' +
          'border-radius:4px;padding:.22rem .7rem;font-size:.68rem;font-weight:700;' +
          'letter-spacing:.1em;text-transform:uppercase;color:#ff4d57;margin-bottom:.85rem;">' +
          '🔥 Trending Now' +
        '</div>' +

        /* Title */
        '<h1 style="font-size:clamp(1.8rem,4.5vw,3.8rem);font-weight:900;' +
          'letter-spacing:-.04em;line-height:1;margin-bottom:.6rem;' +
          'text-transform:uppercase;text-shadow:0 2px 20px rgba(0,0,0,.5);">' +
          title +
        '</h1>' +

        /* Meta: rating · year · type */
        '<div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.75rem;flex-wrap:wrap;">' +
          (rating
            ? '<span style="display:flex;align-items:center;gap:.25rem;color:#f5c518;font-weight:700;font-size:.8rem;">' +
                '★ ' + rating + '</span>' +
              '<span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.3);display:inline-block;"></span>'
            : '') +
          (year
            ? '<span style="font-size:.78rem;color:rgba(255,255,255,.5);font-weight:500;">' + year + '</span>' +
              '<span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.3);display:inline-block;"></span>'
            : '') +
          '<span style="font-size:.78rem;color:rgba(255,255,255,.5);font-weight:500;">' + label + '</span>' +
        '</div>' +

        /* Overview */
        '<p style="font-size:.9rem;line-height:1.65;color:rgba(255,255,255,.6);' +
          'margin-bottom:1.5rem;display:-webkit-box;-webkit-line-clamp:3;' +
          '-webkit-box-orient:vertical;overflow:hidden;">' +
          desc +
        '</p>' +

        /* Buttons */
        '<div style="display:flex;gap:.65rem;align-items:center;">' +
          '<button ' +
            'onclick="window.openPlayerModal(' + key + ',\'' + type + '\')" ' +
            'style="display:inline-flex;align-items:center;gap:.45rem;' +
              'background:#fff;color:#000;border:none;border-radius:7px;' +
              'font-family:inherit;font-size:.9rem;font-weight:700;' +
              'padding:.62rem 1.5rem;cursor:pointer;">' +
            '▶ Play' +
          '</button>' +
          '<button ' +
            'style="display:inline-flex;align-items:center;gap:.45rem;' +
              'background:rgba(109,109,110,.65);color:#fff;border:none;border-radius:7px;' +
              'font-family:inherit;font-size:.9rem;font-weight:600;' +
              'padding:.62rem 1.3rem;cursor:pointer;">' +
            'ⓘ More Info' +
          '</button>' +
        '</div>' +

      '</div>';

    return { el: slide, bgEl: slide.querySelector('div') };
  }

  /* ── Go to slide index ───────────────────────────────────────── */
  function goTo(idx) {
    if (!slides.length) return;

    /* Deactivate current */
    slides[current].el.style.opacity      = '0';
    slides[current].el.style.pointerEvents = 'none';
    slides[current].bgEl.style.transform  = '';
    dotBtns[current].style.background     = 'rgba(255,255,255,.3)';
    dotBtns[current].style.width          = '28px';

    current = (idx + slides.length) % slides.length;

    /* Activate next */
    slides[current].el.style.opacity      = '1';
    slides[current].el.style.pointerEvents = 'auto';
    slides[current].bgEl.style.transform  = 'scale(1.05)';
    dotBtns[current].style.background     = '#e50914';
    dotBtns[current].style.width          = '48px';

    animateProgress();
  }

  /* ── Animate progress bar ────────────────────────────────────── */
  function animateProgress() {
    progBar.style.transition = 'none';
    progBar.style.width      = '0%';
    progBar.getBoundingClientRect(); /* flush */
    progBar.style.transition = 'width ' + SLIDE_DURATION + 'ms linear';
    progBar.style.width      = '100%';
  }

  /* ── Start auto-advance ─────────────────────────────────────── */
  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(function () { goTo(current + 1); }, SLIDE_DURATION);
  }

  /* ── Public: init(items, type) ───────────────────────────────── */
  function init(items, type) {
    ensureContainer();
    clearInterval(autoTimer);

    /* Remove old slides */
    slides.forEach(function (s) { s.el.remove(); });
    slides  = [];
    dotBtns = [];
    dotsEl.innerHTML = '';
    current = 0;

    /* Filter items that have a backdrop or poster */
    var pool = items
      .filter(function (it) { return it.backdrop_path || it.poster_path; })
      .slice(0, MAX_SLIDES);

    if (!pool.length) return;

    /* Build slides */
    pool.forEach(function (item, i) {
      var s = makeSlide(item, type || 'movie');

      /* Insert before dots/progress */
      container.insertBefore(s.el, dotsEl);
      slides.push(s);

      /* Ken Burns starts inactive */
      s.bgEl.style.transition = 'transform ' + SLIDE_DURATION + 'ms ease';

      /* Dot button */
      var dot = document.createElement('button');
      dot.style.cssText =
        'width:28px;height:3px;border-radius:2px;' +
        'background:rgba(255,255,255,.3);border:none;cursor:pointer;padding:0;' +
        'transition:background .3s,width .3s;';
      dot.addEventListener('click', function () {
        goTo(i);
        clearInterval(autoTimer);
        startAuto();
      });
      dotsEl.appendChild(dot);
      dotBtns.push(dot);
    });

    /* Activate first slide */
    slides[0].el.style.opacity      = '1';
    slides[0].el.style.pointerEvents = 'auto';
    slides[0].bgEl.style.transform  = 'scale(1.05)';
    dotBtns[0].style.background     = '#e50914';
    dotBtns[0].style.width          = '48px';

    animateProgress();
    startAuto();
  }

  return { init: init };

})();
