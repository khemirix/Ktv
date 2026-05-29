window.IS_TV_APP =
  navigator.userAgent.includes("Tizen") ||
  navigator.userAgent.includes("SMART-TV") ||
  window.location !== window.parent.location;

(async function () {
  const mainContent = document.getElementById('mainContent');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');
  let currentTab = 'movies';

  // ── TV Remote ────────────────────────────────────────────────────
  if (window.IS_TV_APP) {
    document.body.classList.add("tv-mode");
    document.addEventListener("keydown", function (e) {
      const focusable = Array.from(document.querySelectorAll('[tabindex="0"]:not([disabled])'));
      if (!focusable.length) return;
      let index = focusable.indexOf(document.activeElement);
      if (index === -1) { focusable[0].focus(); return; }
      switch (e.keyCode) {
        case 37: index = Math.max(0, index - 1); break;
        case 39: index = Math.min(focusable.length - 1, index + 1); break;
        case 38: index = Math.max(0, index - 5); break;
        case 40: index = Math.min(focusable.length - 1, index + 5); break;
        case 13: document.activeElement.click(); return;
        case 10009:
          closePlayer();
          document.body.style.cursor = 'none';
          return;
        default: return;
      }
      e.preventDefault();
      focusable[index].focus();
    });
    window.addEventListener("load", () => {
      const first = document.querySelector('[tabindex="0"]');
      if (first) first.focus();
    });
  }

  // ── Player modal helpers ─────────────────────────────────────────
  function closePlayer() {
    const modal = document.getElementById('playerModal');
    const video = document.getElementById('playerVideo');
    if (video) { video.pause(); video.src = ''; }
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function showLoadingModal(title) {
    const modal = document.getElementById('playerModal');
    const stateLoading = document.getElementById('playerStateLoading');
    const stateVideo   = document.getElementById('playerStateVideo');
    const stateError   = document.getElementById('playerStateError');
    const loadingTitle = document.getElementById('playerLoadingTitle');

    stateLoading.hidden = false;
    stateVideo.hidden   = true;
    stateError.hidden   = true;
    loadingTitle.textContent = `Resolving "${title}"…`;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function showVideoModal(links, title) {
    const stateLoading  = document.getElementById('playerStateLoading');
    const stateVideo    = document.getElementById('playerStateVideo');
    const stateError    = document.getElementById('playerStateError');
    const video         = document.getElementById('playerVideo');
    const qualityList   = document.getElementById('qualityList');
    const playerTitle   = document.getElementById('playerTitle');

    stateLoading.hidden = true;
    stateVideo.hidden   = false;
    stateError.hidden   = true;
    playerTitle.textContent = title;

    // Build quality buttons
    qualityList.innerHTML = '';
    links.forEach((link, i) => {
      const btn = document.createElement('button');
      btn.className = 'quality-btn' + (i === 0 ? ' active' : '');
      btn.textContent = link.quality || `Link ${i + 1}`;
      btn.onclick = () => {
        video.src = link.url;
        video.play();
        qualityList.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
      qualityList.appendChild(btn);
    });

    // Auto-play best (first) link
    video.src = links[0].url;
    video.play().catch(() => {});
  }

  function showErrorModal(message) {
    const stateLoading = document.getElementById('playerStateLoading');
    const stateVideo   = document.getElementById('playerStateVideo');
    const stateError   = document.getElementById('playerStateError');
    const errorMsg     = document.getElementById('playerErrorMsg');

    stateLoading.hidden = true;
    stateVideo.hidden   = true;
    stateError.hidden   = false;
    errorMsg.textContent = message;
  }

  // ── Main play handler ────────────────────────────────────────────
  window.openPlayerModal = async function (item, type) {
    const title = item.title || item.name || 'Unknown';
    const year  = (item.release_date || item.first_air_date || '').split('-')[0] || '';

    showLoadingModal(title);

    try {
      const links = await Resolver.resolve({ title, year, type });
      showVideoModal(links, title);
    } catch (err) {
      showErrorModal(err.message || 'Not found');
    }
  };

  // Close button
  document.getElementById('playerClose').addEventListener('click', closePlayer);

  // Click outside content closes modal
  document.getElementById('playerModal').addEventListener('click', function (e) {
    if (e.target === this) closePlayer();
  });

  // Escape key
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePlayer();
  });

  // ── Cards ────────────────────────────────────────────────────────
  function createMovieCard(item, type) {
    const year = (item.release_date || item.first_air_date || '').split('-')[0] || 'N/A';
    const poster = item.poster_path
      ? TMDB.IMG + item.poster_path
      : 'https://via.placeholder.com/200x300?text=No+Image';
    return `
      <div class="movie-card" tabindex="0" onclick="window.openPlayerModal(${JSON.stringify(item).replace(/"/g,'&quot;')}, '${type}')">
        <img src="${poster}" alt="${item.title || item.name}">
        <div class="movie-card-overlay">
          <div class="movie-card-title">${item.title || item.name}</div>
          <div class="movie-card-info">${year}</div>
          <div class="movie-card-actions">
            <button class="btn-play-small" onclick="event.stopPropagation(); window.openPlayerModal(${JSON.stringify(item).replace(/"/g,'&quot;')}, '${type}')">
              <i class="fas fa-play"></i> Play
            </button>
          </div>
        </div>
      </div>`;
  }

  function createSection(title, items, type) {
    const section = document.createElement('div');
    section.className = 'content-section';
    section.innerHTML = `
      <h2 class="section-title">${title}</h2>
      <div class="movie-grid">${items.map(item => createMovieCard(item, type)).join('')}</div>`;
    return section;
  }

  async function setHeroContent(items) {
    if (!items.length) return;
    const f = items[0];
    document.getElementById('heroImage').style.backgroundImage =
      `url('${f.poster_path ? TMDB.IMG + f.poster_path : ''}')`;
    document.getElementById('heroTitle').textContent = f.title || f.name || 'Featured';
    document.getElementById('heroDescription').textContent =
      f.overview ? f.overview.substring(0, 150) + '…' : 'Stream now';
    document.getElementById('heroPlayBtn').onclick =
      () => window.openPlayerModal(f, currentTab === 'tv' ? 'tv' : 'movie');
  }

  // ── Load content ─────────────────────────────────────────────────
  const sortByDate = arr => arr.slice().sort((a, b) =>
    ((b.release_date || b.first_air_date || '') > (a.release_date || a.first_air_date || '') ? 1 : -1));

  async function loadMovies() {
    const [now, popular, top] = await Promise.all([
      TMDB.moviesNowPlaying(), TMDB.moviesPopular(), TMDB.moviesTopRated()
    ]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(now.results));
    mainContent.appendChild(createSection('Now Playing', sortByDate(now.results).slice(0, 12), 'movie'));
    mainContent.appendChild(createSection('Popular', sortByDate(popular.results).slice(0, 12), 'movie'));
    mainContent.appendChild(createSection('Top Rated', sortByDate(top.results).slice(0, 12), 'movie'));
  }

  async function loadTV() {
    const [airing, popular, top] = await Promise.all([
      TMDB.tvAiringToday(), TMDB.tvPopular(), TMDB.tvTopRated()
    ]);
    mainContent.innerHTML = '';
    await setHeroContent(sortByDate(airing.results));
    mainContent.appendChild(createSection('Airing Today', sortByDate(airing.results).slice(0, 12), 'tv'));
    mainContent.appendChild(createSection('Popular', sortByDate(popular.results).slice(0, 12), 'tv'));
    mainContent.appendChild(createSection('Top Rated', sortByDate(top.results).slice(0, 12), 'tv'));
  }

  async function renderContent(tab) {
    currentTab = tab;
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (tab === 'movies') await loadMovies();
    else if (tab === 'tv') await loadTV();
  }

  tabBtns.forEach(btn => btn.addEventListener('click', () => renderContent(btn.dataset.tab)));

  // ── Search ───────────────────────────────────────────────────────
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = searchInput.value.trim();
    if (!q) return;
    const res = await TMDB.search(q);
    mainContent.innerHTML = '';
    const items = res.results.filter(r => r.media_type !== 'person');
    const section = document.createElement('div');
    section.className = 'content-section';
    section.innerHTML = `
      <h2 class="section-title">Results for "${q}"</h2>
      <div class="movie-grid">${items.map(item => createMovieCard(item, item.media_type || 'movie')).join('')}</div>`;
    mainContent.appendChild(section);
  });

  renderContent('movies');
})();
