/* Central configuration for the Live TV Smart Proxy.
 *
 * This is the ONLY frontend file that contains proxy endpoint URLs.
 * DEFAULT_PROXY_URL is the mandatory primary endpoint.
 * FALLBACK_PROXY_URL is the automatic backup endpoint. It is never the default.
 *
 * Resolution precedence:
 *   1. URL query (?proxy=...) — the only explicit override.
 *   2. DEFAULT_PROXY_URL — Vercel primary.
 *
 * localStorage is deliberately ignored. An old saved SnapDeploy/Render URL
 * must not silently replace the primary. To select another proxy, use the URL:
 *   tv.html?proxy=vercel       -> Vercel primary
 *   tv.html?proxy=snapdeploy   -> SnapDeploy fallback (explicit)
 *   tv.html?proxy=https://...  -> custom proxy (explicit)
 *   tv.html?proxy=off          -> disable the proxy
 *
 * Automatic failover is allowed only for the default Vercel selection and for
 * an explicit ?proxy=vercel selection. An explicit fallback/custom/off choice
 * is never silently replaced by another proxy.
 */
(function (global) {
  'use strict';

  var DEFAULT_PROXY_URL = 'https://ktv-nu.vercel.app';
  var FALLBACK_PROXY_URL = 'https://ktv-86d0f.containers.snapdeploy.app';
  var STORAGE_KEY = 'ktvSmartProxyUrl';

  function select(value) {
    if (typeof value !== 'string') {
      return { url: DEFAULT_PROXY_URL, selection: 'default' };
    }
    var trimmed = value.trim();
    if (/^(off|0|false|none|disabled)$/i.test(trimmed)) {
      return { url: '', selection: 'off' };
    }
    if (/^vercel$/i.test(trimmed)) {
      return { url: DEFAULT_PROXY_URL, selection: 'vercel' };
    }
    if (/^snapdeploy$/i.test(trimmed)) {
      return { url: FALLBACK_PROXY_URL, selection: 'snapdeploy' };
    }
    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      return { url: trimmed.replace(/\/+$/, ''), selection: 'custom' };
    }
    return { url: '', selection: 'invalid' };
  }

  function clean(value) {
    return select(value).url;
  }

  function resolve() {
    var search = (global.location && global.location.search) || '';
    var params = search ? new URLSearchParams(search) : null;
    if (params && params.has('proxy')) {
      var chosen = select(params.get('proxy'));
      return {
        url: chosen.url,
        source: 'query',
        selection: chosen.selection
      };
    }

    // Read only to warn; never use as an override and never delete it.
    var stored = '';
    try {
      stored = (global.localStorage && global.localStorage.getItem(STORAGE_KEY)) || '';
    } catch (e) {}
    if (stored && typeof console !== 'undefined' && console.warn) {
      console.warn('[Smart Proxy] Ignoring saved proxy override. Use ?proxy=vercel, ' +
        '?proxy=snapdeploy, a custom ?proxy=URL, or ?proxy=off instead.');
    }

    return {
      url: DEFAULT_PROXY_URL,
      source: 'default',
      selection: 'default'
    };
  }

  var selected = resolve();

  global.KTV_SMART_PROXY_DEFAULT = DEFAULT_PROXY_URL;
  global.KTV_SMART_PROXY_FALLBACK = FALLBACK_PROXY_URL;
  global.KTV_SMART_PROXY_SOURCE = selected.source;
  global.KTV_SMART_PROXY_SELECTION = selected.selection;
  global.KTV_SMART_PROXY_FAILOVER_ALLOWED =
    selected.selection === 'default' || selected.selection === 'vercel';
  global.KTV_SMART_PROXY_URL = selected.url;
})(typeof window !== 'undefined' ? window : globalThis);
