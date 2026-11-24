/* Khemirix Smart Proxy — thin frontend client for Live TV only.
 * This file contains no backend logic. The proxy base URL is configured by
 * window.KTV_SMART_PROXY_URL in tv.html (or ?proxy= / localStorage for local testing).
 */
(function (global) {
  'use strict';

  function normalizeBase(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
  }

  function isEnabled(base) {
    return !!normalizeBase(base || (global && global.KTV_SMART_PROXY_URL));
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

  function detect(url, options) {
    options = options || {};
    var base = normalizeBase(options.baseUrl || (global && global.KTV_SMART_PROXY_URL));
    if (!base || !url) return Promise.resolve(null);

    var query = '?url=' + encodeURIComponent(url);
    var hint = options.metadata && (options.metadata.format || options.metadata.type);
    if (hint) query += '&format=' + encodeURIComponent(hint);

    var controller = typeof AbortController !== 'undefined'
      ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); },
      options.timeoutMs || 12000) : null;
    var init = { headers: { Accept: 'application/json' } };
    if (controller) init.signal = controller.signal;

    return fetch(base + '/api/detect' + query, init).then(function (response) {
      if (timer) clearTimeout(timer);
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || !body.ok) {
          var error = new Error((body.error && body.error.message) ||
            ('Smart Proxy detection failed (HTTP ' + response.status + ').'));
          error.code = (body.error && body.error.code) || 'PROXY_DETECTION_FAILED';
          error.status = response.status;
          throw error;
        }

        return {
          originalUrl: url,
          mediaUrl: body.playbackUrl,
          format: body.format,
          engine: body.engine,
          via: 'smart-proxy',
          message: buildMessage(body),
          warnings: body.diagnostics || [],
          raw: body
        };
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  global.SmartProxyClient = {
    isEnabled: isEnabled,
    detect: detect,
    normalizeBase: normalizeBase
  };
})(typeof window !== 'undefined' ? window : globalThis);
