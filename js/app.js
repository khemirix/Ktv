/* app.js - Modern streaming site UI with Netflix-style focus navigation */
(async function(){
  const mainContent = document.getElementById('mainContent');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');
  let currentTab = 'movies';
  let allMovies = [];

  // ============================================================================
  // CONTENT RENDERING
  // ============================================================================

  function createMovieCard(item, type) {
    const year = item.release_date ? item.release_date.split('-')[0] : item.first_air_date ? item.first_air_date.split('-')[0] : 'N/A';
    return `
      <div class="movie-card" data-id="${item.id}" data-type="${type}" role="button" aria-label="${item.title || item.name} (${year})">
        <img src="${item.poster_path ? TMDB.IMG + item.poster_path : 'https://via.placeholder.com/220x330?text=No+Image'}" alt="${item.title || item.name}" loading="lazy">
        <div class="movie-card-overlay">
          <div class="movie-card-title">${item.title || item.name}</div>
          <div class="movie-card-info">${year}</div>
          <div class="movie-card-actions">
            <button class="btn-play-small" aria-label="Play ${item.title || item.name}">
              <i class="fas fa-play" aria-hidden="true"></i> Play
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function createSection(title, items, type) {
    const section = document.createElement('div');
    section.className = 'content-section';
    
    const titleEl = document.createElement('h2');
    titleEl.className = 'section-title';
    titleEl.textContent = title;
    
    const gridEl = document.createElement('div');
    gridEl.className = 'movie-grid';
    gridEl.innerHTML = items.map(item => createMovieCard(item, type)).join('');
    
    section.appendChild(titleEl);
    section.appendChild(gridEl);
    
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
    
    const itemType = currentTab === 'tv' ? 'tv' : 'movie';
    heroPlayBtn.onclick = () => PlayerModal.show(itemType, featured.id);
    heroPlayBtn.setAttribute('tabindex', '0');
  }

  // ============================================================================
  // DATA LOADING
  // ============================================================================

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
      
      // Register rows with focus navigation
      registerFocusNavigation();
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
      
      // Register rows with focus navigation
      registerFocusNavigation();
    } catch (err) {
      console.error('Error loading TV:', err);
    }
  }

  async function loadSearch(query) {
    try {
      const res = await TMDB.search(query);
      mainContent.innerHTML = '';
      const items = res.results.filter(r => r.media_type !== 'person');
      
      if (items.length === 0) {
        mainContent.innerHTML = '<div class="content-section"><p style="color: var(--text-secondary); font-size: 1.1rem; padding: 2rem;">No results found for "' + query + '"</p></div>';
        return;
      }
      
      mainContent.appendChild(createSection(`Search Results for "${query}"`, items, 'movie'));
      registerFocusNavigation();
    } catch (err) {
      console.error('Search error:', err);
    }
  }

  async function renderContent(tab) {
    currentTab = tab;
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    
    if (tab === 'movies') await loadMovies();
    else if (tab === 'tv') await loadTV();
    
    // Re-attach listeners after new content is loaded
    attachCardListeners();
    registerFocusNavigation();
  }

  // ============================================================================
  // FOCUS NAVIGATION SETUP
  // ============================================================================

  /**
   * Register all movie-grid rows with the focus navigation system
   */
  function registerFocusNavigation() {
    const movieGrids = Array.from(document.querySelectorAll('.movie-grid'));
    
    if (movieGrids.length > 0) {
      FocusNav.reset();
      FocusNav.registerRows(movieGrids);
      // Start with first row, first item
      FocusNav.focusItem(0, 0);
    }
  }

  /**
   * Attach click handlers to movie cards using event delegation
   */
  function attachCardListeners() {
    // Use event delegation on the main content container
    // Remove any previous delegated listener by using a named function
    if (mainContent._clickHandler) {
      mainContent.removeEventListener('click', mainContent._clickHandler);
    }
    
    mainContent._clickHandler = function(e) {
      const card = e.target.closest('.movie-card');
      if (card) {
        const type = card.dataset.type;
        const id = card.dataset.id;
        if (type && id) {
          console.log(`Opening: ${type} ${id}`);
          PlayerModal.show(type, id);
        }
      }
    };
    
    mainContent.addEventListener('click', mainContent._clickHandler);
  }

  // ============================================================================
  // TAB NAVIGATION
  // ============================================================================

  tabBtns.forEach((btn, index) => {
    btn.setAttribute('tabindex', index === 0 ? '0' : '-1');
    
    btn.addEventListener('click', () => {
      renderContent(btn.dataset.tab);
      // Update tab button focus
      tabBtns.forEach(b => b.setAttribute('tabindex', '-1'));
      btn.setAttribute('tabindex', '0');
    });
    
    btn.addEventListener('keydown', (e) => {
      let target = null;
      
      if (e.key === 'ArrowLeft' && index > 0) {
        target = tabBtns[index - 1];
      } else if (e.key === 'ArrowRight' && index < tabBtns.length - 1) {
        target = tabBtns[index + 1];
      } else if (e.key === 'ArrowDown') {
        // Move to first movie in first grid
        e.preventDefault();
        btn.blur();
        FocusNav.focusItem(0, 0);
        return;
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

  // ============================================================================
  // SEARCH FUNCTIONALITY
  // ============================================================================

  searchInput.setAttribute('tabindex', '0');
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (!q) return;
      
      await loadSearch(q);
      registerFocusNavigation();
    } else if (e.key === 'ArrowDown') {
      // Move from search to first movie
      e.preventDefault();
      searchInput.blur();
      FocusNav.focusItem(0, 0);
    }
  });

  // ============================================================================
  // HERO SECTION NAVIGATION
  // ============================================================================

  const heroPlayBtn = document.getElementById('heroPlayBtn');
  if (heroPlayBtn) {
    heroPlayBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        FocusNav.focusItem(0, 0);
      }
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Initialize focus navigation system
  FocusNav.init('.content-container');
  FocusNav.configure({
    scrollBehavior: 'smooth',
    scrollPaddingTop: 150,
    scrollPaddingBottom: 150,
    focusScale: 1.15,
    transitionDuration: 300,
    itemScrollMargin: 50,
    enableDimming: false  // Disable dimming for better card visibility
  });

  // Attach card click listeners and register rows after content loads
  async function initialize() {
    await renderContent('movies');
    attachCardListeners();
  }

  initialize();
})();
