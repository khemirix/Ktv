'use strict';

// Never emit query strings, userinfo, headers, or full IPTV paths in logs.
function redactUrl(input) {
  try {
    var parsed = new URL(String(input));
    return parsed.protocol + '//' + parsed.hostname + '/<redacted>';
  } catch (e) {
    return '<invalid-url>';
  }
}

function safeLog(component, message, url) {
  var suffix = url ? ' target=' + redactUrl(url) : '';
  // eslint-disable-next-line no-console
  console.warn('[' + component + '] ' + message + suffix);
}

module.exports = { redactUrl, safeLog };
