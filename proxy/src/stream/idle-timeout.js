'use strict';

// Resets an idle timer whenever the upstream response produces data. Data
// arrival is reported explicitly by the reader/forwarder, so the guard never
// changes stream flow mode or consumes bytes before the caller is ready.
function createIdleGuard(response, idleMs, onTimeout) {
  var timer = null;
  var disposed = false;
  var dataListener = null;

  function arm() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      if (!disposed) onTimeout();
    }, idleMs);
  }

  function touch() { arm(); }

  function onData() { arm(); }

  function watchData() {
    if (disposed || dataListener) return;
    dataListener = onData;
    response.on('data', dataListener);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (dataListener) {
      response.removeListener('data', dataListener);
      dataListener = null;
    }
    response.removeListener('close', dispose);
  }

  response.once('close', dispose);
  arm();

  return { touch: touch, watchData: watchData, dispose: dispose };
}

module.exports = { createIdleGuard };
