'use strict';

function rewritePlaylist(text, sourceUrl, publicBaseUrl) {
  var base = String(publicBaseUrl || '').replace(/\/+$/, '');
  var source = String(sourceUrl || '');
  var newline = String(text).indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  var lines = String(text).split(/\r?\n/);

  function proxied(uri) {
    if (/^(data|blob):/i.test(String(uri).trim())) return uri;
    var resolved;
    try {
      resolved = new URL(uri, source).href;
    } catch (e) {
      return uri;
    }
    if (!base) return resolved;
    return base + '/api/stream?url=' + encodeURIComponent(resolved);
  }

  var rewritten = lines.map(function (line) {
    if (/^\s*#/.test(line)) {
      return line.replace(/URI="([^"]*)"/g, function (all, uri) {
        return 'URI="' + proxied(uri) + '"';
      });
    }
    var trimmed = line.trim();
    if (!trimmed) return line;
    if (/^(data|blob):/i.test(trimmed)) return line;
    return proxied(trimmed);
  });

  return rewritten.join(newline);
}

module.exports = { rewritePlaylist };
