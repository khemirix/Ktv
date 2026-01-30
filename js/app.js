/* app.js - Modern streaming site UI with TV Remote Support */
(async function(){
  const mainContent = document.getElementById('mainContent');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');
  let currentTab = 'movies';
  let allMovies = [];
  let focusedElement = null;

  function createMovieCard(item, type) {
    const year = item.release_date ? item.release_date.split('-')[0] : item.first_air_date ? item.first_air_date.split('-')[0] : 'N/A';
    return `
      <div class="movie-card" data-id="${item.id}" data-type="${type}" tabindex="0" role="button" aria-label="${item.title || item.name}">
        <img src="${item.poster_path ? TMDB.IMG + item.poster_path : 'https://via.placeholder.com/200x300?text=No+Image'}" alt="${item.title || item.name}">
        <div class="movie-card-overlay">
          <div class="movie-card-title">${item.title || item.name}</div>
          <div class="movie-card-info">${year}</div>
          <div class="movie-card-actions">
            <button class="btn-play-small" tabindex="-1">
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
    heroPlayBtn.setAttribute('tabindex', '0');
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
      attachCardListeners();
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
      attachCardListeners();
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

  // Attach click and keyboard listeners to cards
  function attachCardListeners() {
    document.querySelectorAll('.movie-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.dataset.type;
        const id = card.dataset.id;
        PlayerModal.show(type, id);
      });
      
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const type = card.dataset.type;
          const id = card.dataset.id;
          PlayerModal.show(type, id);
        }
      });
    });
  }

  // Tab navigation with keyboard
  tabBtns.forEach((btn, index) => {
    btn.setAttribute('tabindex', index === 0 ? '0' : '-1');
    btn.addEventListener('click', () => {
      renderContent(btn.dataset.tab);
      tabBtns.forEach(b => b.setAttribute('tabindex', '-1'));
      btn.setAttribute('tabindex', '0');
    });
    
    btn.addEventListener('keydown', (e) => {
      let target = null;
      if (e.key === 'ArrowLeft' && index > 0) {
        target = tabBtns[index - 1];
      } else if (e.key === 'ArrowRight' && index < tabBtns.length - 1) {
        target = tabBtns[index + 1];
      }
      
      if (target) {
        e.preventDefault();
        target.setAttribute('tabindex', '0');
        tabBtns.forEach(b => b !== target && b.setAttribute('tabindex', '-1'));
        target.focus();
        renderContent(target.dataset.tab);
      }
    });
  });

  // Search with keyboard support
  searchInput.setAttribute('tabindex', '0');
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
        attachCardListeners();
      } catch (err) {
        console.error('Search error:', err);
      }
    }
  });

  // Global keyboard navigation (arrow keys to navigate focus through interactive elements)
  document.addEventListener('keydown', (e) => {
    if (document.fullscreenElement) return; // Don't interfere with player fullscreen
    
    const focusableElements = document.querySelectorAll('.tab-btn, .movie-card, .btn-play-small, #heroPlayBtn, #searchInput');
    const currentFocused = document.activeElement;
    const focusIndex = Array.from(focusableElements).indexOf(currentFocused);
    
    if (e.key === 'ArrowUp' && focusIndex > 0) {
      e.preventDefault();
      focusableElements[focusIndex - 1].focus();
    } else if (e.key === 'ArrowDown' && focusIndex < focusableElements.length - 1) {
      e.preventDefault();
      focusableElements[focusIndex + 1].focus();
    }
  });

  // Initial load
  renderContent('movies');
})();
