/* app.js - Modern streaming site UI */
(async function(){
  const mainContent = document.getElementById('mainContent');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');
  let currentTab = 'movies';
  let allMovies = [];

  function createMovieCard(item, type) {
    const year = item.release_date ? item.release_date.split('-')[0] : item.first_air_date ? item.first_air_date.split('-')[0] : 'N/A';
    return `
      <div class="movie-card" data-id="${item.id}" data-type="${type}" onclick="PlayerModal.show('${type}', '${item.id}')">
        <img src="${item.poster_path ? TMDB.IMG + item.poster_path : 'https://via.placeholder.com/200x300?text=No+Image'}" alt="${item.title || item.name}">
        <div class="movie-card-overlay">
          <div class="movie-card-title">${item.title || item.name}</div>
          <div class="movie-card-info">${year}</div>
          <div class="movie-card-actions">
            <button class="btn-play-small" onclick="event.stopPropagation(); PlayerModal.show('${type}', '${item.id}')">
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
    if (items.length === 0) return;
    const featured = items[0];
    const heroImage = document.getElementById('heroImage');
    const heroTitle = document.getElementById('heroTitle');
    const heroDescription = document.getElementById('heroDescription');
    const heroPlayBtn = document.getElementById('heroPlayBtn');
    
    const posterUrl = featured.poster_path ? TMDB.IMG + featured.poster_path : '';
    heroImage.style.backgroundImage = `url('${posterUrl}')`;
    heroTitle.textContent = featured.title || featured.name || 'Featured Content';
    heroDescription.textContent = featured.overview ? featured.overview.substring(0, 100) + '...' : 'Stream now';
    heroPlayBtn.onclick = () => PlayerModal.show(currentTab === 'tv' ? 'tv' : 'movie', featured.id);
  }

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

  // Tab navigation
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => renderContent(btn.dataset.tab));
  });

  // Search
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

  // Initial load
  renderContent('movies');
})();
