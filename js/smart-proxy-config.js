/* Central configuration for the Live TV Smart Proxy.
 *
 * This is the ONLY file that contains the deployed proxy URL.
 * Replace DEFAULT_PROXY_URL here when the backend moves.
 *
 * Runtime overrides (no code edit needed):
 *   tv.html?proxy=https://another-proxy.example
 *   localStorage.setItem('ktvSmartProxyUrl', 'https://another-proxy.example')
 *   tv.html?proxy=off  (or localStorage value "off") disables the proxy.
 */
(function (global) {
  'use strict';

  var DEFAULT_PROXY_URL = 'https://ktv-edmu.onrender.com';

  function clean(value) {
    if (typeof value !== 'string') return '';
    var trimmed = value.trim();
    if (/^(off|0|false|none|disabled)$/i.test(trimmed)) return '';
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
  global.KTV_SMART_PROXY_SOURCE = selected.source;
  global.KTV_SMART_PROXY_URL = selected.url;
})(window);
