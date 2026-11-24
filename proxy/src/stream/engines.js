'use strict';

const { forwardStream } = require('./forward');
const { proxyError } = require('../utils/errors');

// Direct forwarding is the default engine. The FFmpeg engine is a deliberate
// placeholder: it is never selected unless explicitly configured, and it does
// not affect normal playback.
class DirectForwardingEngine {
  constructor() { this.name = 'direct'; }

  forward(opened, req, res, options) {
    return forwardStream(opened, req, res, options);
  }
}

class FfmpegEngine {
  constructor() { this.name = 'ffmpeg'; }

  forward() {
    throw proxyError(501, 'ENGINE_NOT_CONFIGURED',
      'FFmpeg processing is not configured. Direct forwarding is used by default.');
  }
}

function selectEngine(name) {
  if (String(name || '').toLowerCase() === 'ffmpeg') return new FfmpegEngine();
  return new DirectForwardingEngine();
}

module.exports = { selectEngine, DirectForwardingEngine, FfmpegEngine };
