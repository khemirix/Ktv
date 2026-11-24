'use strict';

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

function clientRequestHeaders(req) {
  var out = {
    'User-Agent': 'KhemirixSmartProxy/1.0',
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Connection: 'close'
  };
  var range = req && req.headers ? req.headers.range : '';
  if (range) out.Range = String(range);
  return out;
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
  copyUpstreamHeaders,
  ALLOWED_RESPONSE_HEADERS: ALLOWED
};
