/* Khemirix Smart Proxy — thin frontend client for Live TV only.
 * This file contains no backend logic and no hardcoded proxy URL.
 * The primary URL comes from js/smart-proxy-config.js
 * (window.KTV_SMART_PROXY_URL / KTV_SMART_PROXY_FALLBACK).
 */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 30000;
  var STREAM_VERIFY_TIMEOUT_MS = 8000;
  var RETRYABLE = {
    DNS_FAILURE: true,
    DNS_TIMEOUT: true,
    CONNECT_TIMEOUT: true,
    TLS_TIMEOUT: true,
    UPSTREAM_TIMEOUT: true,
    TOO_MANY_STREAMS: true,
    RATE_LIMITED: true,
    DETECTION_TIMEOUT: true
  };
  var FAILOVER_CODES = {
    DNS_FAILURE: true,
    DNS_TIMEOUT: true,
    CONNECT_TIMEOUT: true,
    TLS_TIMEOUT: true,
    UPSTREAM_TIMEOUT: true,
    UPSTREAM_UNRECOVERABLE_EARLY_EOF: true,
    UPSTREAM_UNREACHABLE: true,
    TOO_MANY_STREAMS: true,
    RATE_LIMITED: true,
    DETECTION_TIMEOUT: true,
    INVALID_PROXY_RESPONSE: true,
    PROXY_UNAVAILABLE: true,
    PROXY_DETECTION_FAILED: true,
    STREAM_PROXY_FAILED: true,
    STREAM_PROXY_NETWORK: true
  };
  var NON_FAILOVER_CODES = {
    BLOCKED_ADDRESS: true,
    INVALID_URL: true,
    INVALID_PROTOCOL: true,
    CLIENT_CLOSED: true
  };
  var FRIENDLY = {
    DNS_FAILURE: 'The stream host could not be resolved. The provider link may have expired.',
    DNS_TIMEOUT: 'The stream host lookup timed out. Please try again shortly.',
    CONNECT_TIMEOUT: 'The proxy could not connect to the stream host in time.',
    TLS_TIMEOUT: 'The secure connection to the stream host timed out.',
    UPSTREAM_TIMEOUT: 'The stream server did not respond in time.',
    STREAM_IDLE_TIMEOUT: 'The stream stopped sending data.',
    UPSTREAM_UNREACHABLE: 'The proxy could not reach the stream server.',
    BLOCKED_ADDRESS: 'The proxy blocked this stream address for safety.',
    INVALID_URL: 'The stream URL is not valid.',
    INVALID_PROTOCOL: 'Only HTTP and HTTPS streams are supported.',
    TOO_MANY_STREAMS: 'The proxy is busy with other streams. Try again shortly.',
    RATE_LIMITED: 'The proxy is busy. Try again in a moment.',
    DETECTION_TIMEOUT: 'The proxy did not respond in time. It may be waking up; try again.',
    INVALID_PROXY_RESPONSE: 'The proxy returned an invalid response.',
    PROXY_UNAVAILABLE: 'The proxy is unavailable or waking up.',
    PROXY_DETECTION_FAILED: 'The proxy could not identify this stream.',
    STREAM_PROXY_FAILED: 'The proxy stream endpoint failed.',
    STREAM_PROXY_NETWORK: 'The proxy stream endpoint could not be reached.'
  };

  function normalizeBase(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
  }

  // Some deployments return a playbackUrl built from a stale public base URL.
  // Rebase only the origin onto the selected proxy; path and query stay intact.
  function rebaseToProxy(value, base) {
    if (typeof value !== 'string' || !base) return value;
    try {
      var parsed = new URL(value);
      var proxy = new URL(base);
      if (parsed.origin === proxy.origin) return value;
      parsed.protocol = proxy.protocol;
      parsed.host = proxy.host;
      return parsed.href;
    } catch (e) {
      return value;
    }
  }

  // A sleeping container can leave a cached "waking up" HTML page on a repeated
  // proxy URL. A unique cache-buster keeps detect/stream requests fresh
  // without caching live media or exposing credentials in new places.
  function withCacheBuster(value) {
    if (typeof value !== 'string' || !value) return value;
    var stamp = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
    try {
      var parsed = new URL(value);
      parsed.searchParams.set('_cb', stamp);
      return parsed.href;
    } catch (e) {
      return value + (value.indexOf('?') === -1 ? '?' : '&') + '_cb=' + encodeURIComponent(stamp);
    }
  }

  function isEnabled(base) {
    return !!normalizeBase(base || (global && global.KTV_SMART_PROXY_URL));
  }

  function friendlyMessage(err) {
    if (!err) return '';
    if (err.code === 'UPSTREAM_HTTP_ERROR') return err.message || '';
    var mapped = FRIENDLY[err.code];
    if (!mapped) return err.message || '';
    if (err.details && err.details.length) {
      return mapped + ' (' + err.details.join(' ') + ')';
    }
    return mapped;
  }

  function isFailoverError(err) {
    if (!err || err.code === 'CLIENT_CLOSED') return false;
    if (err.failover === true) return true;
    if (NON_FAILOVER_CODES[err.code]) return false;
    if (Number(err.status) >= 500) return true;
    if (FAILOVER_CODES[err.code]) return true;
    if (err.name === 'TypeError' || err.name === 'NetworkError') return true;
    return /fetch failed|failed to fetch|network|timeout|unavailable/i.test(err.message || '');
  }

  function isRetryableError(err) {
    if (!err || err.code === 'CLIENT_CLOSED') return false;
    return err.retryable === true || RETRYABLE[err.code] === true;
  }

  function buildMessage(result) {
    if (!result.proxyStreamingSupported) {
      return 'Smart Proxy could not identify a playable format (' + result.format + ').';
    }
    if (result.confidence === 'low') {
      return 'Smart Proxy detected ' + result.format + ' with low confidence; playback will still use ' + result.engine + '.';
    }
    return 'Smart Proxy detected ' + result.format + ' via ' + result.reason + '.';
  }

  function abortError() {
    var err = new Error('The request was cancelled.');
    err.name = 'AbortError';
    err.code = 'CLIENT_CLOSED';
    return err;
  }

  function delay(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(abortError()); return; }
      var timer = setTimeout(function () {
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
        reject(abortError());
      }
      if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
    });
  }

  function requestOnce(url, options) {
    var base = normalizeBase(options.baseUrl || (global && global.KTV_SMART_PROXY_URL));
    var query = '?url=' + encodeURIComponent(url);
    var hint = options.metadata && (options.metadata.format || options.metadata.type);
    if (hint) query += '&format=' + encodeURIComponent(hint);
    query += '&_cb=' + encodeURIComponent(String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8));

    var external = options.signal || null;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var onExternal = null;
    var timedOut = false;
    var timer = null;

    if (controller && external) {
      onExternal = function () { try { controller.abort(); } catch (e) {} };
      if (external.aborted) onExternal();
      else if (external.addEventListener) external.addEventListener('abort', onExternal);
    }

    var init = { headers: { Accept: 'application/json' } };
    if (controller) init.signal = controller.signal;
    else if (external) init.signal = external;

    if (controller) {
      timer = setTimeout(function () {
        timedOut = true;
        try { controller.abort(); } catch (e) {}
      }, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (external && onExternal && external.removeEventListener) {
        external.removeEventListener('abort', onExternal);
      }
    }

    return fetch(base + '/api/detect' + query, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        cleanup();
        if (external && external.aborted) throw abortError();
        if (!response.ok || !body.ok) {
          var code = (body.error && body.error.code) ||
            (Number(response.status) >= 500 ? 'PROXY_UNAVAILABLE' : 'PROXY_DETECTION_FAILED');
          var error = new Error((body.error && body.error.message) ||
            ('Smart Proxy detection failed (HTTP ' + response.status + ').'));
          error.code = code;
          error.status = response.status;
          error.details = (body.error && body.error.details) || [];
          throw error;
        }
        if (!body.playbackUrl || !body.format || !body.engine) {
          var incomplete = new Error('Smart Proxy returned an incomplete response.');
          incomplete.code = 'INVALID_PROXY_RESPONSE';
          incomplete.status = response.status;
          throw incomplete;
        }

        return {
          originalUrl: url,
          mediaUrl: withCacheBuster(rebaseToProxy(body.playbackUrl, base)),
          format: body.format,
          engine: body.engine,
          via: 'smart-proxy',
          message: buildMessage(body),
          warnings: body.diagnostics || [],
          raw: body
        };
      });
    }).catch(function (err) {
      cleanup();
      if (timedOut) {
        var timeoutError = new Error('The proxy did not respond in time.');
        timeoutError.code = 'DETECTION_TIMEOUT';
        throw timeoutError;
      }
      if (external && external.aborted) throw abortError();
      throw err;
    });
  }

  // Verify the real /api/stream endpoint with a header-only request before
  // playback. This never buffers media and cannot replace a valid stream with
  // a fallback; it only catches wake pages/5xx/network failures.
  function verifyStream(result, options) {
    if (options.verifyStream === false || typeof fetch !== 'function') {
      return Promise.resolve(result);
    }

    var external = options.signal || null;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var onExternal = null;
    var timedOut = false;
    var timer = null;

    if (controller && external) {
      onExternal = function () { try { controller.abort(); } catch (e) {} };
      if (external.aborted) onExternal();
      else if (external.addEventListener) external.addEventListener('abort', onExternal);
    }

    var init = { method: 'HEAD', headers: { Accept: '*/*' } };
    if (controller) init.signal = controller.signal;
    else if (external) init.signal = external;

    if (controller) {
      timer = setTimeout(function () {
        timedOut = true;
        try { controller.abort(); } catch (e) {}
      }, Number(options.streamVerifyTimeoutMs) || STREAM_VERIFY_TIMEOUT_MS);
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (external && onExternal && external.removeEventListener) {
        external.removeEventListener('abort', onExternal);
      }
    }

    return fetch(result.mediaUrl, init).then(function (response) {
      cleanup();
      if (external && external.aborted) throw abortError();
      var contentType = response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('content-type') || '').toLowerCase() : '';
      if (contentType.indexOf('text/html') !== -1) {
        var wakeError = new Error('The proxy returned a wake page instead of a stream.');
        wakeError.code = 'STREAM_PROXY_FAILED';
        wakeError.status = response.status || 503;
        wakeError.failover = true;
        throw wakeError;
      }
      if (!response.ok) {
        var httpError = new Error('The proxy stream endpoint returned HTTP ' + response.status + '.');
        httpError.code = 'STREAM_PROXY_FAILED';
        httpError.status = response.status;
        httpError.failover = Number(response.status) >= 500;
        throw httpError;
      }
      return result;
    }).catch(function (err) {
      cleanup();
      if (external && external.aborted) throw abortError();
      if (err && err.code === 'STREAM_PROXY_FAILED') throw err;
      if (timedOut) {
        var timeoutError = new Error('The proxy stream endpoint did not respond in time.');
        timeoutError.code = 'STREAM_PROXY_NETWORK';
        timeoutError.failover = true;
        throw timeoutError;
      }
      var networkError = new Error('The proxy stream endpoint could not be reached.');
      networkError.code = 'STREAM_PROXY_NETWORK';
      networkError.failover = true;
      throw networkError;
    });
  }

  function candidateBases(options) {
    var primary = normalizeBase(options.baseUrl || (global && global.KTV_SMART_PROXY_URL));
    var fallback = normalizeBase(options.fallbackBaseUrl || (global && global.KTV_SMART_PROXY_FALLBACK));
    var bases = primary ? [primary] : [];
    if (options.allowFallback !== false && fallback && bases.indexOf(fallback) === -1) {
      bases.push(fallback);
    }
    return bases;
  }

  function detect(url, options) {
    options = options || {};
    var bases = candidateBases(options);
    if (!bases.length || !url) return Promise.resolve(null);
    var index = 0;
    var earlierFailures = [];

    function attemptBase(base, retriesUsed) {
      var attemptOptions = {};
      Object.keys(options).forEach(function (key) { attemptOptions[key] = options[key]; });
      attemptOptions.baseUrl = base;

      return requestOnce(url, attemptOptions)
        .then(function (detected) { return verifyStream(detected, attemptOptions); })
        .catch(function (err) {
          var allowRetry = retriesUsed < (Math.max(0, Number(options.retries) || 0)) &&
            isRetryableError(err) && !(options.signal && options.signal.aborted);
          if (allowRetry) {
            return delay(350 * (retriesUsed + 1), options.signal)
              .then(function () { return attemptBase(base, retriesUsed + 1); });
          }
          throw err;
        });
    }

    function attemptNext() {
      var currentBase = bases[index];
      return attemptBase(currentBase, 0).then(function (detected) {
        detected.baseUrl = currentBase;
        detected.failoverUsed = index > 0;
        detected.triedBases = bases.slice(0, index + 1);
        if (detected.failoverUsed) {
          detected.warnings = (detected.warnings || []).concat(
            'Switched to the backup proxy after the primary proxy failed.');
        }
        return detected;
      }).catch(function (err) {
        if (!isFailoverError(err) || index >= bases.length - 1 ||
            (options.signal && options.signal.aborted)) {
          err.message = friendlyMessage(err) || err.message;
          if (earlierFailures.length) {
            var last = earlierFailures[earlierFailures.length - 1];
            err.message += ' Backup proxy also failed: ' + (friendlyMessage(last) || last.message);
          }
          err.triedBases = bases.slice();
          throw err;
        }
        earlierFailures.push(err);
        index += 1;
        return attemptNext();
      });
    }

    return attemptNext();
  }

  global.SmartProxyClient = {
    isEnabled: isEnabled,
    detect: detect,
    normalizeBase: normalizeBase,
    candidateBases: candidateBases
  };
})(typeof window !== 'undefined' ? window : globalThis);
