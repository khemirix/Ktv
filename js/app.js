window.IS_TV_APP =

      console.error('Error loading TV:', err);

    }
  }

  // --------------------------
  // Render
  // --------------------------
  async function renderContent(tab) {

    currentTab = tab;

    tabBtns.forEach(btn => {
      btn.classList.toggle(
        'active',
        btn.dataset.tab === tab
      );
    });

    if (tab === 'movies') {
      await loadMovies();
    } else {
      await loadTV();
    }
  }

  // --------------------------
  // Tabs
  // --------------------------
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      renderContent(btn.dataset.tab);
    });
  });

  // --------------------------
  // Search
  // --------------------------
  searchInput.addEventListener('keydown', async (e) => {

    if (e.key !== 'Enter') return;

    const q = searchInput.value.trim();

    if (!q) return;

    try {

      const res = await TMDB.search(q);

      mainContent.innerHTML = '';

      const items = res.results.filter(
        r => r.media_type !== 'person'
      );

      const section = document.createElement('div');

      section.className = 'content-section';

      section.innerHTML = `
        <h2 class="section-title">
          Search Results for "${q}"
        </h2>

        <div class="movie-grid">
          ${items.map(item =>
            createMovieCard(item, item.media_type || 'movie')
          ).join('')}
        </div>
      `;

      mainContent.appendChild(section);

    } catch(err) {

      console.error('Search error:', err);

    }
  });

  // --------------------------
  // Start
  // --------------------------
  renderContent('movies');

})();