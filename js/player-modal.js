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

  function requestFullscreen(el) {
    if (!el) return;
    setTimeout(() => {
      const request = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (request) {
        request.call(el).catch(() => {});
      }
    }, 1000);
  }

  function loadPlayerDetails(type, id, season = '1', episode = '1') {
    try {
      if (!frame) return;
      
      if (type === 'tv' && id) {
        frame.src = `https://player.videasy.net/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?autoPlay=true&color=e50914&nextEpisode=true&episodeSelector=true`;
      } else if (type === 'movie' && id) {
        frame.src = `https://player.videasy.net/movie/${encodeURIComponent(id)}?autoPlay=true&color=e50914`;
      }

      // Request fullscreen after iframe loads
      frame.onload = () => {
        try { 
          frame.contentWindow && frame.contentWindow.focus(); 
        } catch (e) {}
        requestFullscreen(frame);
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
      if (document.fullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) exit.call(document).catch(() => {});
      }
    }
  };
})();
