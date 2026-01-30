/* js/anti-ads.js
 * Helper to reduce ads/popups for cross-origin embedded players.
 * - Normalizes the iframe "allow" attribute to only required features
 * - Detects ad/redirect-like URLs and blocks or sanitizes them
 * - Provides a small API for further checks
 *
 * Usage:
 *   blockPlayerAds(frameElement, { allowedHosts: ['vidking.net'], allowSameOrigin: false })
 */
(function (global) {
  'use strict';

  function isAllowedHost(url, allowedHosts) {
    try {
      const u = new URL(url);
      return allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
    } catch (e) {
      return false;
    }
  }

  function looksLikeAdUrl(url) {
    if (!url) return false;
    const adPatterns = /ad|ads|advert|interstitial|promo|click|doubleclick|tracker|pop|subscribe|banner/i;
    try {
      const u = new URL(url);
      return adPatterns.test(u.hostname) || adPatterns.test(u.pathname + (u.search || ''));
    } catch (e) {
      return adPatterns.test(url);
    }
  }

  function sanitizeAllowAttr(allowValue) {
    // Keep only autoplay and fullscreen (these are often needed for players)
    // Remove allow-popups or other dangerous directives
    const allowedParts = ['autoplay', 'fullscreen'];
    const parts = (allowValue || '').split(';').map(p => p.trim()).filter(Boolean);
    const keep = parts.filter(p => allowedParts.some(a => p.indexOf(a) !== -1));
    return keep.join('; ');
  }

  function blockPlayerAds(iframe, opts) {
    if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
      console.warn('blockPlayerAds: iframe element required');
      return { installed: false };
    }

    const options = Object.assign({
      allowedHosts: ['vidking.net'],
      allowSameOrigin: false, // safer default
      detectAdPatterns: true,
      onBlocked: function (reason, url) { console.warn('Blocked iframe navigation:', reason, url); }
    }, opts || {});

    // Enforce safe "allow" attribute
    const newAllow = sanitizeAllowAttr(iframe.getAttribute('allow')) || 'autoplay; fullscreen';
    iframe.setAttribute('allow', newAllow);

    // Sandbox enforcement removed — do not modify iframe sandbox attribute here.

    // Add a mutation observer to detect if src changes to a non-allowed host
    let lastSrc = iframe.src || iframe.getAttribute('src') || '';

    function checkSrcAndSanitize(src) {
      // If src looks like an ad or not in allowed hosts, block it
      if (options.detectAdPatterns && looksLikeAdUrl(src)) {
        options.onBlocked('pattern', src);
        // Replace with blank to avoid showing ad
        iframe.src = 'about:blank';
        return false;
      }

      if (!isAllowedHost(src, options.allowedHosts)) {
        options.onBlocked('host', src);
        // If not allowed host, blank the iframe to avoid navigating to third-party ad domains
        iframe.src = 'about:blank';
        return false;
      }

      // Looks fine
      return true;
    }

    // Intercept changes to the src that might happen from other code
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'data-src')) {
          const newSrc = iframe.getAttribute('src') || iframe.src;
          if (newSrc !== lastSrc) {
            lastSrc = newSrc;
            checkSrcAndSanitize(newSrc);
          }
        }
      });
    });

    observer.observe(iframe, { attributes: true, attributeFilter: ['src', 'data-src'] });

    // Run initial check
    checkSrcAndSanitize(lastSrc);

    // Add load handler to re-check (works even with cross-origin src; we only inspect the URL)
    iframe.addEventListener('load', () => {
      // If the frame navigated to a different URL (e.g., redirected to an interstitial ad), check again
      const currentSrc = iframe.src || iframe.getAttribute('src') || '';
      if (currentSrc !== lastSrc) {
        lastSrc = currentSrc;
        checkSrcAndSanitize(currentSrc);
      }
    }, { passive: true });

    // Optionally add a translucent overlay that captures middle-clicks to avoid "open in new tab" if desired
      // (the overlay gives an extra layer to capture clicks and avoid opening in a new tab).
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;';
    overlay.setAttribute('aria-hidden', 'true');
    // Make sure iframe's parent is positioned
    const parent = iframe.parentElement;
    if (parent) {
      const computed = getComputedStyle(parent);
      if (computed.position === 'static') parent.style.position = 'relative';
      parent.appendChild(overlay);
      // Only enable pointer capture when "lockClicks" option is set
      if (opts && opts.lockClicks) {
        overlay.style.pointerEvents = 'auto';
        // Allow clicking via a tiny "Enable controls" button if desired
        overlay.innerHTML = '<button class="play-enable-controls" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 12px;border-radius:4px;border:1px solid rgba(0,0,0,0.15);background:#fff;">Enable player</button>';
        overlay.querySelector('.play-enable-controls').addEventListener('click', (e) => {
          overlay.style.pointerEvents = 'none';
          e.preventDefault();
        });
      }
    }

    return {
      installed: true,
      teardown: function () {
        observer.disconnect();
        try { iframe.removeEventListener('load', () => {}); } catch (e) {}
        if (parent && overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
      }
    };
  }

  // Expose the function globally
  global.blockPlayerAds = blockPlayerAds;

})(window);
