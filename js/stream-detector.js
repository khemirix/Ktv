/* Reliable stream-format detection for Ktv Live TV.
 *
 * The URL extension is only a weak hint. A stream is identified from the
 * HTTP response, Content-Type, initial bytes, playlist signatures, and any
 * channel metadata supplied by the caller. The caller receives the exact URL
 * that answered (direct or proxied) plus the playback engine to use.
 */
(function (root) {
  'use strict';

  var SNIFF_BYTES = 4096;
  var DEFAULT_TIMEOUT_MS = 8000;

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  function mimeOf(contentType) {
    return text(contentType).split(';')[0].trim().toLowerCase();
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function formatFromContentType(contentType) {
    var mime = mimeOf(contentType);
    if (!mime) return null;
    if (/mpegurl|m3u8/.test(mime)) return 'hls';
    if (mime === 'video/mp2t' || mime === 'video/mpegts' ||
        mime === 'application/vnd.dvb.transport') return 'mpegts';
    if (mime === 'video/mp4' || mime === 'application/mp4') return 'mp4';
    if (mime === 'video/webm') return 'webm';
    if (mime === 'video/ogg' || mime === 'application/ogg') return 'ogg';
    if (mime === 'text/html' || mime === 'application/json' ||
        mime === 'text/plain' || mime === 'text/xml') return 'document';
    return null;
  }

  function formatFromUrl(url) {
    var path = text(url).split(/[?#]/)[0].toLowerCase();
    if (/\.m3u8$/.test(path)) return 'hls';
    if (/\.ts$/.test(path)) return 'mpegts';
    if (/\.mp4$/.test(path)) return 'mp4';
    if (/\.webm$/.test(path)) return 'webm';
    if (/\.ogg$/.test(path)) return 'ogg';
    return null;
  }

  function formatFromMetadata(metadata) {
    if (!metadata) return null;
    var raw = text(metadata.format || metadata.type ||
      metadata.streamType || metadata.mime).toLowerCase();
    if (!raw) return null;
    if (/hls|m3u8|mpegurl/.test(raw)) return 'hls';
    if (/mpeg-?ts|mp2t|transport.?stream|(^|[^a-z])ts$/.test(raw)) return 'mpegts';
    if (/mp4/.test(raw)) return 'mp4';
    if (/webm/.test(raw)) return 'webm';
    if (/ogg/.test(raw)) return 'ogg';
    return null;
  }

  // Returns a format only when the bytes positively identify one.
  function sniffBytes(input) {
    var bytes = input;
    if (bytes && typeof bytes.buffer === 'string' && typeof atob === 'function') {
      var binary = atob(bytes.buffer);
      bytes = new Uint8Array(binary.length);
      for (var j = 0; j < binary.length; j += 1) bytes[j] = binary.charCodeAt(j);
    }
    if (!bytes || !bytes.length) return null;
    if (typeof bytes.length !== 'number') return null;
    if (!(bytes instanceof Uint8Array)) {
      try { bytes = new Uint8Array(bytes); } catch (e) { return null; }
    }
    if (!bytes.length) return null;

    var start = 0;
    while (start < bytes.length && (
      bytes[start] === 0x20 || bytes[start] === 0x09 ||
      bytes[start] === 0x0a || bytes[start] === 0x0d ||
      bytes[start] === 0xef || bytes[start] === 0xbb || bytes[start] === 0xbf
    )) start += 1;

    var sample = '';
    var end = Math.min(bytes.length, start + 512);
    for (var i = start; i < end; i += 1) {
      sample += String.fromCharCode(bytes[i]);
    }

    if (/^#EXTM3U/.test(sample)) return 'hls';
    if (bytes[0] === 0x47) {
      // A 188-byte packet boundary is the strongest TS signal. For a short
      // prefix, require a plausible MPEG-TS second byte (no error bit).
      if (bytes.length >= 189 && bytes[188] === 0x47) return 'mpegts';
      if (bytes.length < 189 && (bytes[1] & 0x80) === 0) return 'mpegts';
    }
    if (bytes.length >= 8 &&
        bytes[4] === 0x66 && bytes[5] === 0x74 &&
        bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4';
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 &&
        bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
    if (/^<!doctype html|^<html|^<\!\[CDATA\[/i.test(sample)) return 'document';
    if (/^FLV/.test(sample)) return 'unsupported';
    return null;
  }

  function proxyUrl(base, url) {
    if (!base) return '';
    // The Smart Proxy exposes /api/stream, not the legacy /fetch endpoint.
    return text(base).replace(/\/+$/, '') + '/api/stream?url=' + encodeURIComponent(url);
  }

  function readPrefix(response, limit) {
    var max = Number(limit) || SNIFF_BYTES;
    if (response.body && typeof response.body.getReader === 'function') {
      var reader = response.body.getReader();
      var chunks = [];
      var total = 0;
      return new Promise(function (resolve, reject) {
        function pump() {
          reader.read().then(function (result) {
            if (result.done) { resolve(concat(chunks, total)); return; }
            var value = result.value;
            if (value && value.length) {
              chunks.push(value);
              total += value.length;
            }
            if (total >= max) {
              try { reader.cancel(); } catch (e) {}
              resolve(concat(chunks, total, max));
              return;
            }
            pump();
          }).catch(function (err) {
            try { reader.cancel(); } catch (e) {}
            reject(err);
          });
        }
        pump();
      });
    }
    if (typeof response.arrayBuffer === 'function') {
      return response.arrayBuffer().then(function (buffer) {
        return new Uint8Array(buffer).slice(0, max);
      });
    }
    return Promise.resolve(new Uint8Array(0));
  }

  function concat(chunks, total, max) {
    var size = Math.min(max || total, total);
    var out = new Uint8Array(size);
    var offset = 0;
    for (var i = 0; i < chunks.length && offset < size; i += 1) {
      var chunk = chunks[i];
      if (!chunk || !chunk.length) continue;
      var take = Math.min(chunk.length, size - offset);
      for (var j = 0; j < take; j += 1) out[offset + j] = chunk[j];
      offset += take;
    }
    return out;
  }

  function probe(url, options) {
    if (typeof root.fetch !== 'function') {
      return Promise.reject(new Error('fetch is unavailable'));
    }
    var external = options.signal || null;
    var controller = (typeof root.AbortController === 'function')
      ? new root.AbortController() : null;
    var onExternal = null;
    var timer = null;
    var payload = { credentials: 'omit', cache: 'no-store' };

    if (controller) {
      payload.signal = controller.signal;
      if (external) {
        onExternal = function () { try { controller.abort(); } catch (e) {} };
        if (external.aborted) onExternal();
        else if (external.addEventListener) external.addEventListener('abort', onExternal);
      }
      var timeout = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
      timer = root.setTimeout
        ? root.setTimeout(function () { controller.abort(); }, timeout)
        : setTimeout(function () { controller.abort(); }, timeout);
    } else if (external) {
      payload.signal = external;
    }

    function cleanup() {
      if (timer !== null) {
        if (root.clearTimeout) root.clearTimeout(timer);
        else clearTimeout(timer);
        timer = null;
      }
      if (external && onExternal && external.removeEventListener) {
        external.removeEventListener('abort', onExternal);
      }
    }

    return root.fetch(url, payload).then(function (response) {
      var contentType = (response.headers && typeof response.headers.get === 'function')
        ? response.headers.get('content-type') : '';
      var status = response.status || 0;
      if (!response.ok) {
        cleanup();
        return { ok: false, status: status, contentType: contentType,
                 bytes: new Uint8Array(0) };
      }
      return readPrefix(response, options.sniffBytes).then(function (bytes) {
        cleanup();
        return { ok: true, status: status, contentType: contentType, bytes: bytes };
      }, function (err) {
        cleanup();
        throw err;
      });
    }, function (err) {
      cleanup();
      throw err;
    });
  }

  function httpMessage(status, via) {
    if (status === 401 || status === 403) {
      return 'The stream rejected access (HTTP ' + status +
        '). It may be expired or require a valid subscription.';
    }
    if (status === 410) return 'The stream has expired (HTTP 410).';
    if (status === 404) return 'The stream was not found (HTTP 404).';
    if (status >= 500) {
      if (via === 'proxy') return 'The proxy could not reach this stream (HTTP ' + status + ').';
      return 'The stream server returned HTTP ' + status + '.';
    }
    return 'The stream returned HTTP ' + status + '.';
  }

  function networkMessage(via, err) {
    if (via === 'proxy') {
      return 'Could not reach the stream proxy. Check your connection or try again later.';
    }
    return 'Could not connect to the stream directly. Trying the proxy...';
  }

  function resolveFormat(probe, url, metadata) {
    var sniffed = sniffBytes(probe.bytes);
    var fromType = formatFromContentType(probe.contentType);
    var fromMeta = formatFromMetadata(metadata);
    var fromUrl = formatFromUrl(url);
    var warnings = [];

    if (sniffed && sniffed !== 'document' && sniffed !== 'unsupported') {
      if (fromType && fromType !== sniffed && fromType !== 'document') {
        warnings.push('Server reported ' + mimeOf(probe.contentType) +
          ' but the stream data identifies ' + sniffed + '.');
      }
      return {
        format: sniffed,
        confidence: 'high',
        reason: 'content signature',
        warnings: warnings
      };
    }

    if (sniffed === 'document' || fromType === 'document') {
      return {
        format: 'unsupported',
        confidence: 'high',
        reason: 'HTML/error document instead of media',
        warnings: warnings
      };
    }

    if (sniffed === 'unsupported') {
      return { format: 'unsupported', confidence: 'high',
               reason: 'unsupported container signature', warnings: warnings };
    }

    if (fromType && fromType !== 'application/octet-stream') {
      return { format: fromType, confidence: 'medium',
               reason: 'Content-Type', warnings: warnings };
    }

    if (fromMeta) {
      warnings.push('Format taken from channel metadata because the response was inconclusive.');
      return { format: fromMeta, confidence: 'low',
               reason: 'channel metadata', warnings: warnings };
    }

    if (fromUrl) {
      warnings.push('Format inferred from the URL extension; no stronger signal was available.');
      return { format: fromUrl, confidence: 'low',
               reason: 'URL extension', warnings: warnings };
    }

    return { format: 'unsupported', confidence: 'high',
             reason: 'format could not be identified', warnings: warnings };
  }

  function chooseEngine(format, env) {
    env = env || {};
    var Hls = env.Hls || root.Hls;
    var mpegts = env.mpegts || root.mpegts;
    var video = env.video;

    if (format === 'hls') {
      if (Hls && typeof Hls.isSupported === 'function' && Hls.isSupported()) {
        return { engine: 'hls.js', message: '' };
      }
      if (video && typeof video.canPlayType === 'function' &&
          (video.canPlayType('application/vnd.apple.mpegurl') ||
           video.canPlayType('application/x-mpegURL'))) {
        return { engine: 'native-hls', message: '' };
      }
      return { engine: null,
        message: 'This browser cannot play HLS here. HLS.js is unavailable and native HLS is not supported.' };
    }

    if (format === 'mpegts') {
      if (mpegts && typeof mpegts.isSupported === 'function' && mpegts.isSupported()) {
        return { engine: 'mpegts.js', message: '' };
      }
      return { engine: null,
        message: 'MPEG-TS cannot be decoded by this browser. It needs a browser with Media Source Extensions, or server-side transcoding to HLS.' };
    }

    if (format === 'mp4' || format === 'webm' || format === 'ogg') {
      var mime = format === 'mp4' ? 'video/mp4' :
        (format === 'webm' ? 'video/webm' : 'video/ogg');
      if (video && typeof video.canPlayType === 'function' && video.canPlayType(mime)) {
        return { engine: 'native', message: '' };
      }
      return { engine: null,
        message: 'This browser cannot play ' + mime + ' video directly.' };
    }

    return { engine: null,
      message: 'This stream format is not supported by the browser. It requires server-side transcoding.' };
  }

  function detectionFromProbe(probe, via, url, metadata, env, warnings) {
    var resolved = resolveFormat(probe, url, metadata);
    var selected = chooseEngine(resolved.format, env);
    var allWarnings = (warnings || []).concat(resolved.warnings || []);
    return {
      originalUrl: url,
      mediaUrl: via === 'proxy' ? proxyUrl(env.proxy, url) : url,
      via: via,
      ok: true,
      status: probe.status,
      contentType: probe.contentType,
      format: resolved.format,
      confidence: resolved.confidence,
      reason: resolved.reason,
      engine: selected.engine,
      message: selected.message,
      warnings: allWarnings,
      detectedBytes: probe.bytes ? probe.bytes.length : 0
    };
  }

  function metadataDetection(url, metadata, env, warning) {
    var format = formatFromMetadata(metadata);
    var selected = chooseEngine(format, env);
    return {
      originalUrl: url,
      mediaUrl: proxyUrl(env.proxy, url) || url,
      via: 'metadata',
      ok: true,
      status: 0,
      contentType: '',
      format: format || 'unsupported',
      confidence: 'low',
      reason: 'channel metadata fallback',
      engine: selected.engine,
      message: selected.message,
      warnings: [warning],
      detectedBytes: 0
    };
  }

  function detect(url, options) {
    options = options || {};
    var env = options.env || {
      video: options.video,
      Hls: options.Hls,
      mpegts: options.mpegts,
      proxy: options.proxy
    };
    env.proxy = env.proxy || options.proxy || '';

    var candidates = [];
    if (options.tryDirect !== false) candidates.push({ via: 'direct', url: url });
    if (env.proxy) {
      candidates.push({ via: 'proxy', url: proxyUrl(env.proxy, url) });
    }

    var lastError = null;
    var directWarning = null;
    var unsupportedResult = null;

    return candidates.reduce(function (chain, candidate) {
      return chain.then(function (result) {
        if (result) return result;
        return probe(candidate.url, options).then(function (probeResult) {
          if (!probeResult.ok) {
            lastError = {
              kind: candidate.via === 'proxy' ? 'proxy' : 'upstream',
              message: httpMessage(probeResult.status, candidate.via)
            };
            if (candidate.via === 'direct' && probeResult.status < 500) {
              directWarning = lastError.message;
            }
            return null;
          }
          var detected = detectionFromProbe(probeResult, candidate.via, url,
            options.metadata, env, directWarning ? [directWarning] : []);
          // A 200 HTML page is not proof that no other route can play the
          // stream. Keep probing, but remember this result for the user.
          if (!detected.engine || detected.format === 'unsupported') {
            if (!unsupportedResult) unsupportedResult = detected;
            return null;
          }
          return detected;
        }, function (err) {
          lastError = {
            kind: candidate.via === 'proxy' ? 'proxy' : 'network',
            message: networkMessage(candidate.via, err)
          };
          return null;
        });
      });
    }, Promise.resolve(null)).then(function (result) {
      if (result) return result;
      if (unsupportedResult) return unsupportedResult;
      if (options.allowMetadataFallback && formatFromMetadata(options.metadata)) {
        var warning = lastError ? lastError.message : 'Direct detection was inconclusive.';
        return metadataDetection(url, options.metadata, env, warning);
      }
      var error = new Error(lastError ? lastError.message :
        'The stream format could not be identified.');
      error.kind = lastError ? lastError.kind : 'unknown';
      error.fatal = true;
      throw error;
    });
  }

  var api = {
    detect: detect,
    sniffBytes: sniffBytes,
    proxyUrl: proxyUrl,
    formatFromContentType: formatFromContentType,
    formatFromUrl: formatFromUrl,
    formatFromMetadata: formatFromMetadata,
    chooseEngine: chooseEngine
  };

  root.StreamDetector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
