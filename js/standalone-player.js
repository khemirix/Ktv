/* Standalone IPTV proxy player. Uses the shared LiveStreamPlayer so extensionless
 * streams are detected by Content-Type/manifest inspection instead of filename.
 */
(function () {
  var PROXY = 'https://t-ahg3.onrender.com';
  var live = null;

  function byId(id) { return document.getElementById(id); }

  function log(message, type) {
    var body = byId('logBody');
    var line = document.createElement('div');
    line.className = 'log-line ' + (type || 'info');
    var time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = '[' + new Date().toTimeString().slice(0, 8) + ']';
    line.appendChild(time);
    line.appendChild(document.createTextNode(message));
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  function clearLog() { byId('logBody').textContent = ''; }

  function setStatus(state) {
    var dot = byId('statusDot');
    var tag = byId('statusTag');
    dot.className = 'dot';
    tag.className = 'status-tag';
    if (state === 'loading') {
      dot.classList.add('live');
      tag.classList.add('loading');
      tag.textContent = 'LOADING';
    } else if (state === 'playing') {
      dot.classList.add('ok');
      tag.classList.add('playing');
      tag.textContent = 'LIVE';
    } else if (state === 'error') {
      tag.classList.add('error');
      tag.textContent = 'ERROR';
    } else {
      tag.classList.add('idle');
      tag.textContent = 'IDLE';
    }
  }

  function showOverlay(show, loading) {
    var overlay = byId('overlay');
    if (!show) {
      overlay.classList.add('hidden');
      return;
    }
    overlay.classList.remove('hidden');
    overlay.textContent = '';
    if (loading) {
      var spinner = document.createElement('div');
      spinner.className = 'spinner';
      var text = document.createElement('div');
      text.className = 'overlay-text';
      text.textContent = 'Detecting stream and connecting…';
      overlay.appendChild(spinner);
      overlay.appendChild(text);
    } else {
      var icon = document.createElement('div');
      icon.className = 'overlay-icon';
      icon.textContent = '▶';
      var hint = document.createElement('div');
      hint.className = 'overlay-text';
      hint.textContent = 'Enter a stream ID above and press Play';
      overlay.appendChild(icon);
      overlay.appendChild(hint);
    }
  }

  function loadStream() {
    var streamId = byId('streamInput').value.trim();
    if (!streamId) {
      log('No stream ID entered.', 'warn');
      return;
    }
    // Stream IDs can be provider credentials; never print them in the console.
    byId('streamDisplay').textContent = PROXY + '/play/••••';
    byId('playerTitle').textContent = 'Stream · format auto-detected';
    byId('playerTitle').classList.add('active');
    setStatus('loading');
    showOverlay(true, true);
    log('Requesting stream (URL hidden).', 'info');
    live.play(PROXY + '/play/' + encodeURIComponent(streamId), {
      name: 'Stream',
      label: 'Stream',
      live: true,
      timeout: 15000
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    byId('proxyDisplay').textContent = PROXY;
    live = LiveStreamPlayer.create({
      video: byId('video'),
      onStatus: function (state, message) {
        setStatus(state === 'playing' ? 'playing' : 'loading');
        if (state === 'playing') {
          showOverlay(false);
          log('Playback started.', 'success');
        } else if (message) {
          showOverlay(true, true);
        }
      },
      onError: function (message) {
        setStatus('error');
        showOverlay(true, false);
        log(message || 'Playback failed.', 'error');
      }
    });
    byId('streamInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') loadStream();
    });
    log('Player ready. Stream IDs are hidden from logs.', 'success');
    showOverlay(true, false);
  });

  window.loadStream = loadStream;
  window.clearLog = clearLog;
})();
