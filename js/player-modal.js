/* player-modal.js - Handles loading the player in a Bootstrap modal */

const PlayerModal = (function(){
  const modal = new bootstrap.Modal(document.getElementById('playerModal'));
  const frame = document.getElementById('playerFrame');
  const titleEl = document.getElementById('playerTitle');
  const overviewEl = document.getElementById('playerOverview');
  const linkEl = document.getElementById('playerLink');
  const modalLabel = document.getElementById('playerModalLabel');

  function showInfo(title, overview) {
    if (!title && !overview) return;
    titleEl.textContent = title || '';
    overviewEl.textContent = overview || '';
    modalLabel.textContent = title || 'Player';
  }

  async function loadPlayerDetails(type, id, season = '1', episode = '1') {
    try {
      frame.src = 'about:blank';
      titleEl.textContent = 'Loading…';
      overviewEl.textContent = '';
      modalLabel.textContent = 'Loading...';
      
      if (type === 'tv' && id && TMDB.getEpisode) {
        const ep = await TMDB.getEpisode(id, season, episode);
        if (ep) {
          showInfo(ep.title || `Season ${ep.season} Episode ${ep.episode}`, ep.overview || '');
        }
        frame.src = `https://www.vidking.net/embed/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?color=e50914&autoPlay=true&nextEpisode=true&episodeSelector=true`;
        const embedUrl = frame.src;
        if (linkEl) { linkEl.href = embedUrl; linkEl.textContent = embedUrl; }
      } else if (type === 'movie' && id && TMDB.getById) {
        const movie = await TMDB.getById(id);
        if (movie) {
          showInfo(movie.title || movie.name || '', movie.overview || '');
        }
        frame.src = `https://www.vidking.net/embed/movie/${encodeURIComponent(id)}?color=e50914&autoPlay=true&nextEpisode=true&episodeSelector=true`;
        const embedUrl = frame.src;
        if (linkEl) { linkEl.href = embedUrl; linkEl.textContent = embedUrl; }
      }
    } catch (err) {
      console.warn('Failed to load player details:', err);
      titleEl.textContent = 'Error loading content';
      overviewEl.textContent = err.message;
    }
  }

  return {
    show: function(type, id, season, episode) {
      loadPlayerDetails(type, id, season, episode);
      modal.show();
    },
    hide: function() {
      modal.hide();
      frame.src = 'about:blank';
    }
  };
})();
