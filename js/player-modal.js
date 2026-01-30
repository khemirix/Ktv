/* player-modal.js - Handles loading the player in a Bootstrap modal */

const PlayerModal = (function(){
  const modal = new bootstrap.Modal(document.getElementById('playerModal'), { backdrop: false, keyboard: true });
  const frame = document.getElementById('playerFrame');

  function requestFullscreen(el) {
    if (!el) return;
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (request) {
      request.call(el).catch(() => {});
    }
  }

  async function loadPlayerDetails(type, id, season = '1', episode = '1') {
    try {
      frame.src = 'about:blank';
      
      if (type === 'tv' && id) {
        frame.src = `https://www.vidking.net/embed/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?color=e50914&autoPlay=true&nextEpisode=true&episodeSelector=true`;
      } else if (type === 'movie' && id) {
        frame.src = `https://www.vidking.net/embed/movie/${encodeURIComponent(id)}?color=e50914&autoPlay=true&nextEpisode=true&episodeSelector=true`;
      }

      // Request fullscreen when iframe loads
      frame.addEventListener('load', () => {
        requestFullscreen(frame);
        try { frame.contentWindow && frame.contentWindow.focus(); } catch (e) {}
      }, { once: true });
      
    } catch (err) {
      console.warn('Failed to load player:', err);
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
      if (document.fullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) exit.call(document).catch(() => {});
      }
    }
  };
})();
