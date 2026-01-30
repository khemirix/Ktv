// Detect TV
window.IS_TV_APP = navigator.userAgent.includes("Tizen") || navigator.userAgent.includes("SMART-TV");

if (window.IS_TV_APP) {

  document.body.classList.add("tv-mode");

  // Focus navigation
  document.addEventListener("keydown", function(e) {
    const focusable = Array.from(document.querySelectorAll('[tabindex="0"]:not([disabled])'));
    if (!focusable.length) return;

    let index = focusable.indexOf(document.activeElement);
    if (index === -1) { focusable[0].focus(); return; }

    switch(e.keyCode){
      case 37: index = Math.max(0, index - 1); break; // LEFT
      case 39: index = Math.min(focusable.length-1, index + 1); break; // RIGHT
      case 38: index = Math.max(0, index - 5); break; // UP
      case 40: index = Math.min(focusable.length-1, index + 5); break; // DOWN
      case 13: // ENTER
        document.activeElement.click(); 
        return;
      case 10009: // BACK
        const modalEl = document.getElementById('playerModal');
        if(modalEl){
          const modal = bootstrap.Modal.getInstance(modalEl);
          if(modal) modal.hide();
        }

        if(document.fullscreenElement){
          const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
          if(exit) exit.call(document);
        }

        // Hide cursor back
        document.body.style.cursor = 'none';
        return;
      default: return;
    }

    e.preventDefault();
    focusable[index].focus();
  });

  // Auto-focus first item
  window.addEventListener("load", () => {
    const first = document.querySelector('[tabindex="0"]');
    if(first) first.focus();
  });

  // Open iframe player in fullscreen + show cursor
  window.openPlayerModal = function(src) {
    const modalEl = document.getElementById('playerModal');
    const iframe = document.getElementById('playerFrame');

    // Set iframe src
    iframe.src = src;

    // Show modal
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Fullscreen the iframe
    iframe.focus();
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
    else if (iframe.msRequestFullscreen) iframe.msRequestFullscreen();

    // Show cursor when iframe open
    document.body.style.cursor = 'default';
  };
}
