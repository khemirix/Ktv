function openPlayerModal(src) {
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
}
