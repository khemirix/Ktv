'use strict';

const { config } = require('../config');

var ALLOWED = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'expires',
  'age',
  'x-content-type-options'
];

var USER_AGENT_PROFILES = {
  default: 'KhemirixSmartProxy/1.3',
  vlc: 'VLC/3.0.21 LibVLC/3.0.21'
};

function userAgentFor(options) {
  options = options || {};
  if (options.upstreamUserAgent) return String(options.upstreamUserAgent);
  var profile = String(options.upstreamUserAgentProfile || 'default').toLowerCase();
  return USER_AGENT_PROFILES[profile] || USER_AGENT_PROFILES.default;
}

function upstreamRequestHeaders(req, options) {
  options = options || {};
  var out = {
    'User-Agent': userAgentFor(options),
    Accept: String(options.upstreamAccept || '*/*'),
    'Accept-Encoding': 'identity',
    Connection: 'close',
    // Live playlists are frequently cached even when the origin intends them
    // to be fresh. Asking every upstream read for a revalidation prevents an
    // old EXT-X-MEDIA-SEQUENCE window from being replayed after recovery.
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  };

  // Only a small, explicitly configured set of headers is allowed upstream.
  // Client cookies, authorization, and other browser headers are never copied.
  if (options.upstreamAcceptLanguage) {
    out['Accept-Language'] = String(options.upstreamAcceptLanguage);
  }
  if (options.upstreamReferer) {
    out.Referer = String(options.upstreamReferer);
  }

  var range = req && req.headers ? req.headers.range : '';
  if (range) out.Range = String(range);
  return out;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Length',
    'Content-Range',
    'Content-Type',
    'Accept-Ranges',
    'X-Proxy-Format',
    'X-Proxy-Engine',
    'X-Proxy-Detection',
    'X-Proxy-Via'
  ].join(', '));
}

// Backward-compatible name used by the stream route.
function clientRequestHeaders(req, options) {
  return upstreamRequestHeaders(req, Object.assign({}, config, options || {}));
}

function copyUpstreamHeaders(upstream, res, overrides) {
  res.statusCode = upstream.statusCode || 502;
  ALLOWED.forEach(function (name) {
    var value = upstream.headers[name];
    if (value !== undefined && value !== null) res.setHeader(name, value);
  });
  Object.keys(overrides || {}).forEach(function (name) {
    var value = overrides[name];
    if (value === null || value === undefined || value === '') {
      res.removeHeader(name);
    } else {
      res.setHeader(name, value);
    }
  });
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = {
  applyCors,
  clientRequestHeaders,
  upstreamRequestHeaders,
  userAgentFor,
  copyUpstreamHeaders,
  ALLOWED_RESPONSE_HEADERS: ALLOWED,
  USER_AGENT_PROFILES: USER_AGENT_PROFILES
};
