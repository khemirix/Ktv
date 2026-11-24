/* Web Worker wrapper for M3UParser. All playlist line processing happens here,
 * off the UI thread. Channels are streamed back as they are parsed.
 */
importScripts('./m3u-parser.js');

var parser = null;
var count = 0;

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type === 'start') {
    count = 0;
    parser = M3UParser.createStreamingParser(data.baseUrl || '', function (channel) {
      count += 1;
      self.postMessage({ type: 'channel', channel: channel });
    }, function (finalCount) {
      self.postMessage({ type: 'done', count: finalCount });
    });
    return;
  }

  if (!parser) {
    self.postMessage({ type: 'error', message: 'Parser was not initialized' });
    return;
  }

  if (data.type === 'chunk') {
    try {
      parser.push(data.text);
      self.postMessage({ type: 'progress', count: count });
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || 'Chunk parse failed' });
    }
    return;
  }

  if (data.type === 'end') {
    try {
      parser.end();
    } catch (e) {
      self.postMessage({ type: 'error', message: (e && e.message) || 'Playlist finalization failed' });
    }
  }
};
