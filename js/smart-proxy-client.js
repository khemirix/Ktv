/* Khemirix Smart Proxy — thin frontend client for Live TV only.
 * This file contains no backend logic and no hardcoded proxy URL.
 * The base URL comes from js/smart-proxy-config.js (window.KTV_SMART_PROXY_URL).
 */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 30000;
  var RETRYABLE = {
    DNS_FAILURE: true,
    DNS_TIMEOUT: true,
    CONNECT_TIMEOUT: true,
    TLS_TIMEOUT: true,
    UPSTREAM_TIMEOUT: true,
    UPSTREAM_UNREACHABLE: true,
    TOO_MANY_STREAMS: true,
    RATE_LIMITED: true,
    DETECTION_TIMEOUT: true
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
    DETECTION_TIMEOUT: 'The proxy did not respond in time. It may be waking up; try again.'
  };

  function normalizeBase(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
  }

  // Some deployments return a playbackUrl built from a stale public base URL.
  // Rebase only the origin onto the configured proxy; path and query stay intact.
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
          var error = new Error((body.error && body.error.message) ||
            ('Smart Proxy detection failed (HTTP ' + response.status + ').'));
          error.code = (body.error && body.error.code) || 'PROXY_DETECTION_FAILED';
          error.status = response.status;
          error.details = (body.error && body.error.details) || [];
          throw error;
        }

        return {
          originalUrl: url,
          mediaUrl: rebaseToProxy(body.playbackUrl, base),
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

  function detect(url, options) {
    options = options || {};
    var base = normalizeBase(options.baseUrl || (global && global.KTV_SMART_PROXY_URL));
    if (!base || !url) return Promise.resolve(null);

    var retries = Math.max(0, Number(options.retries) || 0);
    var used = 0;

    function attempt() {
      return requestOnce(url, options).catch(function (err) {
        var external = options.signal;
        if (used < retries && RETRYABLE[err.code] &&
            !(external && external.aborted)) {
          used += 1;
          return delay(350 * used, external).then(attempt);
        }
        err.message = friendlyMessage(err) || err.message;
        throw err;
      });
    }

    return attempt();
  }

  global.SmartProxyClient = {
    isEnabled: isEnabled,
    detect: detect,
    normalizeBase: normalizeBase
  };
})(typeof window !== 'undefined' ? window : globalThis);
