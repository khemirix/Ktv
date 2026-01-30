window.IS_TV_APP =
  navigator.userAgent.includes("Tizen") ||
  navigator.userAgent.includes("SMART-TV") ||
  window.location !== window.parent.location;

/* app.js - Modern streaming site UI with TV remote support */
(async function() {
  const mainContent = document.getElementById('mainContent');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');
  let currentTab = 'movies';
  let allMovies = [];

  // --------------------------
  // TV Remote Focus Navigation
  // --------------------------
  if (window.IS_TV_APP) {
    document.body.classList.add("tv-mode");

    document.addEventListener("keydown", function(e) {
      const focusable = Array.from(document.querySelectorAll('[tabindex="0"]:not([disabled])'));
      if (!focusable.length) return;

      let index = focusable.indexOf(document.activeElement);
      if (index === -1) { focusable[0].focus(); return; }

      switch(e.keyCode) {
        case 37: index = Math.max(0, index - 1); break; // LEFT
        case 39: index = Math.min(focusable.length-1, index + 1); break; // RIGHT
        case 38: index = Math.max(0, index - 5); break; // UP
        case 40: index = Math.min(focusable.length-1, index + 5); break; // DOWN
        case 13: // ENTER
          document.activeElement.click(); 
          return;
        case 10009: // BACK
          const modalEl = document.getElementById('playerModal');
          if(modalEl){
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
          }
          if(document.fullscreenElement){
            const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
            if(exit) exit.call(document);
          }
          document.body.style.cursor = 'none';
          return;
        default: return;
      }

      e.preventDefault();
      focusable[index].focus();
    });

    window.addEventListener("load", () => {
      const first = document.querySelector('[tabindex="0"]');
      if(first) first.focus();
    });

    // Open iframe player in fullscreen + show cursor
    window.openPlayerModal = function(src) {
      const modalEl = document.getElementById('playerModal');
      const iframe = document.getElementById('playerFrame');

      // Set iframe src
      iframe.src = src;

      // Show modal
      const modal = new bootstrap.Modal(modalEl);
      modal.show();

      // Fullscreen the iframe
      iframe.focus();
      if (iframe.requestFullscreen) iframe.requestFullscreen();
      else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
      else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();

      // Show cursor when iframe is open
      document.body.style.cursor = 'default';
    };
  }

  // --------------------------
  // Movie / TV Cards
  // --------------------------
  function createMovieCard(item, type) {
    const year = item.release_date ? item.release_date.split('-')[0] : item.first_air_date ? item.first_air_date.split('-')[0] : 'N/A';
    return `
      <div class="movie-card" tabindex="0" data-id="${item.id}" data-type="${type}" onclick="window.openPlayerModal('https://player.videasy.net/${type}/${item.id}?color=e50914&autoPlay=true')">
        <img src="${item.poster_path ? TMDB.IMG + item.poster_path : 'https://via.placeholder.com/200x300?text=No+Image'}" alt="${item.title || item.name}">
        <div class="movie-card-overlay">
          <div class="movie-card-title">${item.title || item.name}</div>
          <div class="movie-card-info">${year}</div>
          <div class="movie-card-actions">
            <button class="btn-play-small" onclick="event.stopPropagation(); window.openPlayerModal('https://player.videasy.net/${type}/${item.id}?color=e50914&autoPlay=true')">
              <i class="fas fa-play"></i> Play
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function createSection(title, items, type) {
    const section = document.createElement('div');
    section.className = 'content-section';
    section.innerHTML = `
      <h2 class="section-title">${title}</h2>
      <div class="movie-grid">
        ${items.map(item => createMovieCard(item, type)).join('')}
      </div>
    `;
    return section;
  }

  async function setHeroContent(items) {
    if (!items.length) return;
    const featured = items[0];
    const heroImage = document.getElementById('heroImage');
    const heroTitle = document.getElementById('heroTitle');
    const heroDescription = document.getElementById('heroDescription');
    const heroPlayBtn = document.getElementById('heroPlayBtn');

    const posterUrl = featured.poster_path ? TMDB.IMG + featured.poster_path : '';
    heroImage.style.backgroundImage = `url('${posterUrl}')`;
    heroTitle.textContent = featured.title || featured.name || 'Featured Content';
    heroDescription.textContent = featured.overview ? featured.overview.substring(0, 100) + '...' : 'Stream now';
    heroPlayBtn.onclick = () => window.openPlayerModal(`https://player.videasy.net/${currentTab === 'tv' ? 'tv' : 'movie'}/${featured.id}?color=e50914&autoPlay=true`);
  }

  // --------------------------
  // Load Movies / TV
  // --------------------------
  async function loadMovies() {
    try {
      const [now, popular, top] = await Promise.all([
        TMDB.moviesNowPlaying(),
        TMDB.moviesPopular(),
        TMDB.moviesTopRated()
      ]);

      const sortByDate = arr => arr.slice().sort((a, b) => ((b.release_date || b.first_air_date || '') > (a.release_date || a.first_air_date || '') ? 1 : -1));

      mainContent.innerHTML = '';
      await setHeroContent(sortByDate(now.results));
      mainContent.appendChild(createSection('Now Playing', sortByDate(now.results).slice(0, 12), 'movie'));
      mainContent.appendChild(createSection('Popular', sortByDate(popular.results).slice(0, 12), 'movie'));
      mainContent.appendChild(createSection('Top Rated', sortByDate(top.results).slice(0, 12), 'movie'));
    } catch (err) {
      console.error('Error loading movies:', err);
    }
  }

  async function loadTV() {
    try {
      const [airing, popular, top] = await Promise.all([
        TMDB.tvAiringToday(),
        TMDB.tvPopular(),
        TMDB.tvTopRated()
      ]);

      const sortByDate = arr => arr.slice().sort((a, b) => ((b.first_air_date || '') > (a.first_air_date || '') ? 1 : -1));

      mainContent.innerHTML = '';
      await setHeroContent(sortByDate(airing.results));
      mainContent.appendChild(createSection('Airing Today', sortByDate(airing.results).slice(0, 12), 'tv'));
      mainContent.appendChild(createSection('Popular', sortByDate(popular.results).slice(0, 12), 'tv'));
      mainContent.appendChild(createSection('Top Rated', sortByDate(top.results).slice(0, 12), 'tv'));
    } catch (err) {
      console.error('Error loading TV:', err);
    }
  }

  async function renderContent(tab) {
    currentTab = tab;
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (tab === 'movies') await loadMovies();
    else if (tab === 'tv') await loadTV();
  }

  // --------------------------
  // Tab navigation
  // --------------------------
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => renderContent(btn.dataset.tab));
  });

  // --------------------------
  // Search
  // --------------------------
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (!q) return;

      try {
        const res = await TMDB.search(q);
        mainContent.innerHTML = '';
        const items = res.results.filter(r => r.media_type !== 'person');

        const section = document.createElement('div');
        section.className = 'content-section';
        section.innerHTML = `
          <h2 class="section-title">Search Results for "${q}"</h2>
          <div class="movie-grid">
            ${items.map(item => createMovieCard(item, item.media_type || 'movie')).join('')}
          </div>
        `;
        mainContent.appendChild(section);
      } catch (err) {
        console.error('Search error:', err);
      }
    }
  });

  // --------------------------
  // Initial load
  // --------------------------
  renderContent('movies');
})();