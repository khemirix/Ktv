/* js/anti-ads.js
 * Helper to reduce ads/popups for cross-origin embedded players.
 * - Normalizes the iframe "allow" attribute to only required features
 * - Detects ad/redirect-like URLs and blocks or sanitizes them
 * - Works with aspect-ratio containers using absolutely positioned iframes (e.g., 16:9)
 * - Provides a small API for further checks
 *
 * Example HTML (16:9 container):
 *   <!-- 16:9 Aspect Ratio Container -->
 *   <div style="position: relative; padding-bottom: 56.25%; height: 0;">
 *     <iframe src="https://player.videasy.net/movie/299534" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" frameborder="0" allowfullscreen></iframe>
 *   </div>
 *
 * Usage:
 *   const iframe = document.querySelector('iframe'); // your player iframe
 *   blockPlayerAds(iframe, { allowedHosts: ['videasy.net'], lockClicks: true });
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
    // The overlay is attached to the nearest positioned ancestor so it works with aspect-ratio
    // containers that use an absolutely-positioned iframe (e.g., a 16:9 wrapper).
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;background:transparent;';
    overlay.setAttribute('aria-hidden', 'true');

    // Find nearest positioned ancestor to attach overlay (works with aspect-ratio wrappers)
    const container = (function findPositionedAncestor(el) {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const pos = getComputedStyle(node).position;
        if (pos && pos !== 'static') return node;
        node = node.parentElement;
      }
      return el.parentElement || document.body;
    })(iframe);

    if (container) {
      const computed = getComputedStyle(container);
      if (computed.position === 'static') container.style.position = 'relative';
      container.appendChild(overlay);

      // Hide overlay while iframe (or its container) is in fullscreen so it
      // doesn't cover the video surface (causing a black screen).
      function onFullscreenChange() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!fsEl) {
          // Exited fullscreen — restore overlay if it was visible before
          if (overlay._hiddenForFullscreen) {
            overlay.style.display = overlay._previousDisplay || '';
            overlay._hiddenForFullscreen = false;
          }
          return;
        }

        // If the fullscreen element is the iframe, the container, or contains the iframe,
        // hide the overlay while fullscreen is active.
        try {
          if (fsEl === iframe || fsEl === container || fsEl.contains(iframe)) {
            overlay._previousDisplay = overlay.style.display;
            overlay.style.display = 'none';
            overlay._hiddenForFullscreen = true;
          }
        } catch (e) {
          // Defensive: some browsers may throw if fsEl is from a different realm
        }
      }

      document.addEventListener('fullscreenchange', onFullscreenChange, false);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange, false);
      document.addEventListener('mozfullscreenchange', onFullscreenChange, false);
      document.addEventListener('MSFullscreenChange', onFullscreenChange, false);

      // Only enable pointer capture when "lockClicks" option is set
      if (opts && opts.lockClicks) {
        // When capturing clicks we need the overlay to sit above the iframe. We
        // set a z-index relative to the iframe and remember previous iframe
        // z-index so we can restore it on teardown.
        const prevIframeZ = iframe.style.zIndex;
        const computedIframeZ = parseInt(getComputedStyle(iframe).zIndex, 10);
        const baseIframeZ = isNaN(computedIframeZ) ? 1 : computedIframeZ;
        if (!iframe.style.zIndex) iframe.style.zIndex = baseIframeZ;
        overlay.style.zIndex = (parseInt(iframe.style.zIndex, 10) || baseIframeZ) + 1;
        overlay.style.pointerEvents = 'auto';
        // Allow clicking via a tiny "Enable controls" button if desired
        overlay.innerHTML = '<button class="play-enable-controls" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 12px;border-radius:4px;border:1px solid rgba(0,0,0,0.15);background:#fff;">Enable player</button>';
        overlay.querySelector('.play-enable-controls').addEventListener('click', (e) => {
          overlay.style.pointerEvents = 'none';
          // restore previous iframe z-index if it existed
          if (prevIframeZ !== undefined) iframe.style.zIndex = prevIframeZ;
          e.preventDefault();
        });
        // store prevIframeZ so teardown can restore
        overlay._prevIframeZ = prevIframeZ;
      }

      // store fullscreen listener so teardown can remove it
      overlay._onFullscreenChange = onFullscreenChange;
    }

    return {
      installed: true,
      teardown: function () {
        observer.disconnect();
        try { iframe.removeEventListener('load', () => {}); } catch (e) {}

        // Remove fullscreen listeners
        if (overlay && overlay._onFullscreenChange) {
          document.removeEventListener('fullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('webkitfullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('mozfullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('MSFullscreenChange', overlay._onFullscreenChange, false);
        }

        if (overlay && overlay.parentElement) {
          // restore any modified z-index on iframe
          if (overlay._prevIframeZ !== undefined) {
            try { iframe.style.zIndex = overlay._prevIframeZ; } catch (e) {}
          }
          overlay.parentElement.removeChild(overlay);
        }
      }
    };
  }

  // Expose the function globally
  global.blockPlayerAds = blockPlayerAds;

})(window);

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
    // The overlay is attached to the nearest positioned ancestor so it works with aspect-ratio
    // containers that use an absolutely-positioned iframe (e.g., a 16:9 wrapper).
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;background:transparent;';
    overlay.setAttribute('aria-hidden', 'true');

    // Find nearest positioned ancestor to attach overlay (works with aspect-ratio wrappers)
    const container = (function findPositionedAncestor(el) {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const pos = getComputedStyle(node).position;
        if (pos && pos !== 'static') return node;
        node = node.parentElement;
      }
      return el.parentElement || document.body;
    })(iframe);

    if (container) {
      const computed = getComputedStyle(container);
      if (computed.position === 'static') container.style.position = 'relative';
      container.appendChild(overlay);

      // Hide overlay while iframe (or its container) is in fullscreen so it
      // doesn't cover the video surface (causing a black screen).
      function onFullscreenChange() {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!fsEl) {
          // Exited fullscreen — restore overlay if it was visible before
          if (overlay._hiddenForFullscreen) {
            overlay.style.display = overlay._previousDisplay || '';
            overlay._hiddenForFullscreen = false;
          }
          return;
        }

        // If the fullscreen element is the iframe, the container, or contains the iframe,
        // hide the overlay while fullscreen is active.
        try {
          if (fsEl === iframe || fsEl === container || fsEl.contains(iframe)) {
            overlay._previousDisplay = overlay.style.display;
            overlay.style.display = 'none';
            overlay._hiddenForFullscreen = true;
          }
        } catch (e) {
          // Defensive: some browsers may throw if fsEl is from a different realm
        }
      }

      document.addEventListener('fullscreenchange', onFullscreenChange, false);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange, false);
      document.addEventListener('mozfullscreenchange', onFullscreenChange, false);
      document.addEventListener('MSFullscreenChange', onFullscreenChange, false);

      // Only enable pointer capture when "lockClicks" option is set
      if (opts && opts.lockClicks) {
        // When capturing clicks we need the overlay to sit above the iframe. We
        // set a z-index relative to the iframe and remember previous iframe
        // z-index so we can restore it on teardown.
        const prevIframeZ = iframe.style.zIndex;
        const computedIframeZ = parseInt(getComputedStyle(iframe).zIndex, 10);
        const baseIframeZ = isNaN(computedIframeZ) ? 1 : computedIframeZ;
        if (!iframe.style.zIndex) iframe.style.zIndex = baseIframeZ;
        overlay.style.zIndex = (parseInt(iframe.style.zIndex, 10) || baseIframeZ) + 1;
        overlay.style.pointerEvents = 'auto';
        // Allow clicking via a tiny "Enable controls" button if desired
        overlay.innerHTML = '<button class="play-enable-controls" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 12px;border-radius:4px;border:1px solid rgba(0,0,0,0.15);background:#fff;">Enable player</button>';
        overlay.querySelector('.play-enable-controls').addEventListener('click', (e) => {
          overlay.style.pointerEvents = 'none';
          // restore previous iframe z-index if it existed
          if (prevIframeZ !== undefined) iframe.style.zIndex = prevIframeZ;
          e.preventDefault();
        });
        // store prevIframeZ so teardown can restore
        overlay._prevIframeZ = prevIframeZ;
      }

      // store fullscreen listener so teardown can remove it
      overlay._onFullscreenChange = onFullscreenChange;
    }

    return {
      installed: true,
      teardown: function () {
        observer.disconnect();
        try { iframe.removeEventListener('load', () => {}); } catch (e) {}

        // Remove fullscreen listeners
        if (overlay && overlay._onFullscreenChange) {
          document.removeEventListener('fullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('webkitfullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('mozfullscreenchange', overlay._onFullscreenChange, false);
          document.removeEventListener('MSFullscreenChange', overlay._onFullscreenChange, false);
        }

        if (overlay && overlay.parentElement) {
          // restore any modified z-index on iframe
          if (overlay._prevIframeZ !== undefined) {
            try { iframe.style.zIndex = overlay._prevIframeZ; } catch (e) {}
          }
          overlay.parentElement.removeChild(overlay);
        }
      }
    };
  }

  // Expose the function globally
  global.blockPlayerAds = blockPlayerAds;

})(window);
