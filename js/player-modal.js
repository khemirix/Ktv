/* player-modal.js - Handles loading the player in a Bootstrap modal with TV remote support */

const PlayerModal = (function(){
  let modal = null;
  let isPlayerOpen = false;
  
  function initModal() {
    if (modal) return;
    const modalEl = document.getElementById('playerModal');
    if (modalEl) {
      modal = new bootstrap.Modal(modalEl, { 
        backdrop: false, 
        keyboard: false,
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
        frame.src = `https://www.vidking.net/embed/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?autoPlay=true&color=e50914&nextEpisode=true&episodeSelector=true`;
      } else if (type === 'movie' && id) {
        frame.src = `https://www.vidking.net/embed/movie/${encodeURIComponent(id)}?autoPlay=true&color=e50914`;
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

  // Handle keyboard controls for remote
  function setupRemoteControls() {
    document.addEventListener('keydown', handleRemoteKey, true);
  }

  function removeRemoteControls() {
    document.removeEventListener('keydown', handleRemoteKey, true);
  }

  function handleRemoteKey(e) {
    if (!isPlayerOpen) return;
    
    // Escape/Back button to close player
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      PlayerModal.hide();
      return;
    }
    
    // Allow spacebar to work in player (play/pause)
    if (e.key === ' ') {
      e.preventDefault();
      try {
        frame.contentWindow && frame.contentWindow.postMessage({action: 'play-pause'}, '*');
      } catch (err) {}
      return;
    }
    
    // Arrow keys - allow pass-through to player
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      try {
        frame.contentWindow && frame.contentWindow.postMessage({action: 'key', key: e.key}, '*');
      } catch (err) {}
      return;
    }
    
    // Enter key for selection in player UI
    if (e.key === 'Enter') {
      e.preventDefault();
      try {
        frame.contentWindow && frame.contentWindow.postMessage({action: 'enter'}, '*');
      } catch (err) {}
      return;
    }
  }

  return {
    show: function(type, id, season, episode) {
      initModal();
      if (!modal) {
        console.error('Modal not initialized');
        return;
      }
      isPlayerOpen = true;
      document.body.style.overflow = 'hidden';
      loadPlayerDetails(type, id, season, episode);
      modal.show();
      setupRemoteControls();
    },
    hide: function() {
      initModal();
      isPlayerOpen = false;
      removeRemoteControls();
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
