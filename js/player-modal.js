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
        frame.src = `https://www.vidking.net/embed/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?overlay=true&Play=true&color=e50914&nextEpisode=true&episodeSelector=true`;
      } else if (type === 'movie' && id) {
        // Ensure the iframe can enter fullscreen manually via user interaction
        frame.setAttribute('allow', (frame.getAttribute('allow') || '') + ' fullscreen; autoplay');
        frame.setAttribute('allowfullscreen', '');
        frame.addEventListener('click', (e) => {
9      // Prevent default if a popup might be triggered (heuristic: check for target or delay)
10      // This is a basic block; refine based on what triggers popups
11      setTimeout(() => {
12        try {
13          // If a new window/tab opened, close it immediately (if possible)
14          if (window.length > 1) {  // Rough check for new windows
15            window.close();  // May not work in all cases
16          }
17        } catch (err) {
18          console.log('Popup blocked or not detected:', err);
19        }
20      }, 100);  // Small delay to catch popup attempts
21    });
        frame.src = `https://www.vidking.net/embed/movie/${encodeURIComponent(id)}?overlay=true&Play=true&color=e50914`;
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
      // Add fade class back when hiding the modal
      const modalEl = document.getElementById('playerModal');
      if (modalEl) modalEl.classList.add('fade');
    }
  };
})();
