/* player-modal.js - Handles loading the player in a Bootstrap modal */

const PlayerModal = (function(){
  let modal = null;
  
  function initModal() {
    if (modal) return;
    const modalEl = document.getElementById('playerModal');
    if (modalEl) {
      modal = new bootstrap.Modal(modalEl, { 
        backdrop: false, 
        keyboard: true,
        scroll: false
      });
    }
  }

  const frame = document.getElementById('playerFrame');


  function loadPlayerDetails(type, id, season = '1', episode = '1') {
    try {
      if (!frame) return;
      
      if (type === 'tv' && id) {
        // Ensure the iframe can enter fullscreen manually via user interaction
        frame.setAttribute('allow', (frame.getAttribute('allow') || '') + ' fullscreen; autoplay');
        frame.setAttribute('allowfullscreen', '');
        frame.src = `https://player.videasy.net/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?overlay=true&Play=true&color=e50914&nextEpisode=true&episodeSelector=true`;
      } else if (type === 'movie' && id) {
        // Ensure the iframe can enter fullscreen manually via user interaction
        frame.setAttribute('allow', (frame.getAttribute('allow') || '') + ' fullscreen; autoplay');
        frame.setAttribute('allowfullscreen', '');
        frame.src = `https://player.videasy.net/movie/${encodeURIComponent(id)}?overlay=true&Play=true&color=e50914`;
      }

      // After iframe loads, focus the frame but do NOT request fullscreen programmatically
      frame.onload = () => {
        try { frame.contentWindow && frame.contentWindow.focus(); } catch (e) {}
      };
      
    } catch (err) {
      console.error('Failed to load player:', err);
    }
  }

  return {
    show: function(type, id, season, episode) {
      initModal();
      if (!modal) {
        console.error('Modal not initialized');
        return;
      }
      document.body.style.overflow = 'hidden';
      loadPlayerDetails(type, id, season, episode);
      modal.show();
    },
    hide: function() {
      initModal();
      if (modal) modal.hide();
      document.body.style.overflow = '';
      if (frame) frame.src = 'about:blank';
    }
  };
})();
