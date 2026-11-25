/* Central configuration for the Live TV Smart Proxy.
 *
 * This is the ONLY file that contains proxy endpoint URLs.
 * Replace DEFAULT_PROXY_URL / FALLBACK_PROXY_URL here when backends move.
 *
 * Runtime overrides (no code edit needed):
 *   tv.html?proxy=snapdeploy  -> active SnapDeploy endpoint (default)
 *   tv.html?proxy=render      -> preserved Render fallback endpoint
 *   tv.html?proxy=https://another-proxy.example
 *   localStorage.setItem('ktvSmartProxyUrl', 'https://another-proxy.example')
 *   tv.html?proxy=off  (or localStorage value "off") disables the proxy.
 */
(function (global) {
  'use strict';

  // SnapDeploy is active for current testing; Render remains available.
  var DEFAULT_PROXY_URL = 'https://ktv-86d0f.containers.snapdeploy.app';
  var FALLBACK_PROXY_URL = 'https://ktv-edmu.onrender.com';

  function clean(value) {
    if (typeof value !== 'string') return '';
    var trimmed = value.trim();
    if (/^(off|0|false|none|disabled)$/i.test(trimmed)) return '';
    if (/^snapdeploy$/i.test(trimmed)) return DEFAULT_PROXY_URL;
    if (/^render$/i.test(trimmed)) return FALLBACK_PROXY_URL;
    return trimmed.replace(/\/+$/, '');
  }

  function resolve() {
    var search = (global.location && global.location.search) || '';
    var params = search ? new URLSearchParams(search) : null;
    if (params && params.has('proxy')) {
      return { url: clean(params.get('proxy')), source: 'query' };
    }

    var stored = '';
    try {
      stored = (global.localStorage && global.localStorage.getItem('ktvSmartProxyUrl')) || '';
    } catch (e) {}
    if (stored) return { url: clean(stored), source: 'storage' };

    return { url: DEFAULT_PROXY_URL, source: 'default' };
  }

  var selected = resolve();
  global.KTV_SMART_PROXY_DEFAULT = DEFAULT_PROXY_URL;
  global.KTV_SMART_PROXY_FALLBACK = FALLBACK_PROXY_URL;
  global.KTV_SMART_PROXY_SOURCE = selected.source;
  global.KTV_SMART_PROXY_URL = selected.url;
})(window);
