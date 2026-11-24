'use strict';

// Ties a backend request to the client response. A channel switch or closed
// browser tab aborts the upstream socket instead of leaving it running.
function responseAbort(res) {
  var controller = typeof AbortController !== 'undefined'
    ? new AbortController() : null;
  if (!controller || !res || typeof res.once !== 'function') {
    return { signal: null, complete: function () {}, dispose: function () {} };
  }

  var finished = false;
  function onClose() {
    if (finished) return;
    finished = true;
    try { controller.abort(); } catch (e) {}
  }
  res.once('close', onClose);

  return {
    signal: controller.signal,
    complete: function () { finished = true; },
    dispose: function () { res.removeListener('close', onClose); }
  };
}

module.exports = { responseAbort };
