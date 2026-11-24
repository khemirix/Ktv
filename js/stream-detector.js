/* Extensionless stream detection for Khemirix TV.
 *
 * A missing .m3u8/.ts/.mp4 suffix is not a format. This module asks the server
 * for Content-Type, follows redirects, inspects the first bytes/manifest when
 * the type is ambiguous, and honours explicit MIME overrides from channel
 * metadata. URLs (including tokens/query strings) are never logged or stored
 * by this module.
 */
var StreamDetector = (function () {
  var DEFAULT_TIMEOUT = 8000;
  var SNIFF_BYTES = 2048;

  function cleanType(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
  }

  function extensionKind(url) {
    var path = String(url || '').split(/[?#]/)[0];
    if (/\.m3u8?$/i.test(path)) return 'hls';
    if (/\.ts$|\.mpegts$|\.m2ts$/i.test(path)) return 'mpegts';
    if (/\.mp4$|\.m4v$|\.mov$/i.test(path)) return 'progressive';
    if (/\.mkv$|\.webm$/i.test(path)) return 'progressive';
    if (/\.mp3$|\.m4a$|\.aac$|\.oga$/i.test(path)) return 'audio';
    return '';
  }

  function mimeKind(value) {
    var mime = cleanType(value);
    if (!mime) return '';
    if (/mpegurl|m3u8|application\/x-mpegurl|audio\/mpegurl/.test(mime)) return 'hls';
    if (/mp2t|mpegts|video\/ts/.test(mime)) return 'mpegts';
    if (/video\/mp4|video\/webm|video\/x-matroska|video\/quicktime|video\/ogg/.test(mime)) return 'progressive';
    if (/audio\//.test(mime)) return 'audio';
    if (mime === 'application/octet-stream' || mime === 'application/force-download' ||
        mime === 'binary/octet-stream' || mime === 'text/plain') return 'ambiguous';
    return '';
  }

  function bytesToText(bytes) {
    if (!bytes || !bytes.length) return '';
    var text = '';
    var limit = Math.min(bytes.length, 512);
    for (var i = 0; i < limit; i++) text += String.fromCharCode(bytes[i]);
    return text;
  }

  function sniffBytes(bytes) {
    if (!bytes || bytes.length < 4) return '';
    if (bytes[0] === 0x47 && (bytes.length < 188 || bytes[188] === 0x47)) return 'mpegts';
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'progressive';
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'progressive';
    var text = bytesToText(bytes);
    if (/^\s*#EXTM3U\b/i.test(text)) return 'hls';
    if (/^\s*<\?xml|^\s*<MPD\b/i.test(text)) return 'dash';
    return '';
  }

  function safeError(err) {
    if (err && err.name === 'AbortError') return 'Stream detection timed out';
    return 'Stream detection could not complete';
  }

  function makeResult(kind, info) {
    info = info || {};
    return {
      kind: kind || '',
      mime: cleanType(info.mime),
      // Only a redirect target is stored. The original URL may contain tokens
      // and stays with the caller instead of being copied into detector state.
      finalUrl: info.finalUrl || '',
      source: info.source || 'unknown',
      headers: info.headers || {},
      credentials: info.credentials || 'omit'
    };
  }

  function fromMetadata(url, options) {
    options = options || {};
    var override = cleanType(options.mime || options.contentType || options.type);
    var forced = mimeKind(override);
    if (forced && forced !== 'ambiguous') {
      return Promise.resolve(makeResult(forced, {
        url: url,
        mime: override,
        source: 'metadata',
        headers: options.headers,
        credentials: options.credentials
      }));
    }
    var named = String(options.kind || options.format || '').toLowerCase();
    if (['hls', 'mpegts', 'progressive', 'audio'].indexOf(named) !== -1) {
      return Promise.resolve(makeResult(named, {
        url: url,
        source: 'metadata',
        headers: options.headers,
        credentials: options.credentials
      }));
    }
    return null;
  }

  function readPrefix(response) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      return response.text().then(function (text) {
        var bytes = [];
        for (var i = 0; i < Math.min(text.length, SNIFF_BYTES); i++) {
          bytes.push(text.charCodeAt(i) & 0xff);
        }
        return { bytes: bytes, text: text.slice(0, SNIFF_BYTES) };
      });
    }
    var reader = response.body.getReader();
    return reader.read().then(function (result) {
      var bytes = Array.prototype.slice.call(result.value || []);
      var text = bytesToText(bytes);
      try { reader.cancel(); } catch (e) {}
      return { bytes: bytes, text: text };
    });
  }

  function request(url, options, method) {
    var headers = Object.assign({}, options.headers || {});
    if (method === 'GET') headers.Range = 'bytes=0-' + (SNIFF_BYTES - 1);
    var init = {
      method: method,
      headers: headers,
      redirect: 'follow',
      credentials: options.credentials || 'omit',
      cache: 'no-store',
      signal: options.signal
    };
    return fetch(url, init);
  }

  function detect(url, options) {
    options = options || {};
    url = String(url || '');
    if (!url) return Promise.resolve(makeResult('', { source: 'invalid' }));

    var forced = fromMetadata(url, options);
    if (forced) return forced;

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, options.timeout || DEFAULT_TIMEOUT) : null;
    var opts = Object.assign({}, options, { signal: controller ? controller.signal : undefined });
    var hint = extensionKind(url);

    function finish(result) {
      if (timer) clearTimeout(timer);
      return result;
    }

    return request(url, opts, 'HEAD').then(function (res) {
      var mime = (res.headers && res.headers.get) ? res.headers.get('content-type') : '';
      var kind = mimeKind(mime);
      var finalUrl = res.url || url;
      if (kind && kind !== 'ambiguous') {
        return finish(makeResult(kind, {
          url: url,
          finalUrl: finalUrl && finalUrl !== url ? finalUrl : '',
          mime: mime,
          source: 'content-type',
          headers: options.headers,
          credentials: options.credentials
        }));
      }
      if (res.status === 405 || res.status === 501 || kind === 'ambiguous' || !mime || res.type === 'opaque') {
        return request(url, opts, 'GET').then(function (getRes) {
          var getMime = (getRes.headers && getRes.headers.get) ? getRes.headers.get('content-type') : '';
          var getKind = mimeKind(getMime);
          return readPrefix(getRes).then(function (prefix) {
            var sniffed = sniffBytes(prefix.bytes);
            var chosen = sniffed || (getKind && getKind !== 'ambiguous' ? getKind : '');
            if (!chosen && /^\s*#EXTM3U\b/i.test(prefix.text)) chosen = 'hls';
            if (!chosen) chosen = hint;
            return finish(makeResult(chosen || 'unknown', {
              url: url,
              finalUrl: (getRes.url || finalUrl) && (getRes.url || finalUrl) !== url
                ? (getRes.url || finalUrl) : '',
              mime: getMime || mime,
              source: sniffed ? 'content-sniff' : (getKind ? 'content-type' : 'extension'),
              headers: options.headers,
              credentials: options.credentials
            }));
          });
        });
      }
      return finish(makeResult(hint || 'unknown', {
        url: url,
        finalUrl: finalUrl && finalUrl !== url ? finalUrl : '',
        mime: mime,
        source: hint ? 'extension' : 'unknown',
        headers: options.headers,
        credentials: options.credentials
      }));
    }).catch(function (err) {
      // CORS, HEAD refusal, or a temporary failure must not make an
      // extensionless URL unusable. Fall back to a conservative URL hint.
      return finish(makeResult(hint || 'unknown', {
        url: url,
        source: hint ? 'extension-fallback' : 'detection-failed',
        headers: options.headers,
        credentials: options.credentials
      }));
    });
  }

  return {
    detect: detect,
    fromMetadata: fromMetadata,
    mimeKind: mimeKind,
    extensionKind: extensionKind,
    sniffBytes: sniffBytes,
    cleanType: cleanType
  };
})();
