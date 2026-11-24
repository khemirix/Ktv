'use strict';

const http = require('node:http');
const https = require('node:https');
const dnsCallback = require('node:dns');
const { validateUrl } = require('../security/validate-url');
const { config } = require('../config');
const { proxyError } = require('../utils/errors');
const { safeLog } = require('../utils/redact');

function transportFor(protocol) {
  return protocol === 'https:' ? https : http;
}

function redirectMethod(status, method) {
  if (status === 303 && method !== 'HEAD') return 'GET';
  return method || 'GET';
}

// Node may call a custom lookup with { all: true }. In that case the callback
// must receive an array, otherwise the request fails with ERR_INVALID_IP_ADDRESS.
function pinnedLookup(target) {
  return function (hostname, dnsOptions, callback) {
    var entry = { address: target.address, family: target.family };
    if (dnsOptions && dnsOptions.all) {
      callback(null, [entry]);
    } else {
      callback(null, target.address, target.family);
    }
  };
}

async function openUpstream(rawUrl, options) {
  options = options || {};
  var redirects = options.redirects || 0;
  var method = options.method || 'GET';

  var validated = await validateUrl(rawUrl, options);
  var target = validated.url;
  var transport = transportFor(target.protocol);

  return new Promise(function (resolve, reject) {
    var settled = false;
    var headerTimer = null;
    var idleTimer = null;

    function fail(error) {
      if (settled) return;
      settled = true;
      if (headerTimer) clearTimeout(headerTimer);
      if (idleTimer) clearTimeout(idleTimer);
      reject(error);
    }

    var requestOptions = {
      method: method,
      headers: options.headers || {},
      agent: false,
      lookup: validated.safe
        ? pinnedLookup(validated)
        : function (hostname, dnsOptions, callback) {
            dnsCallback.lookup(hostname, dnsOptions, callback);
          }
    };

    var request = transport.request(target, requestOptions, function (response) {
      if (headerTimer) { clearTimeout(headerTimer); headerTimer = null; }

      var status = response.statusCode || 0;
      var location = response.headers && response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= (options.maxRedirects || config.maxRedirects)) {
          fail(proxyError(502, 'TOO_MANY_REDIRECTS', 'The stream redirected too many times.'));
          return;
        }
        var nextUrl;
        try {
          nextUrl = new URL(location, target).href;
        } catch (e) {
          fail(proxyError(502, 'INVALID_REDIRECT', 'The stream redirect was invalid.'));
          return;
        }
        var redirectOptions = Object.assign({}, options, {
          redirects: redirects + 1,
          method: redirectMethod(status, method)
        });
        // A localhost-only test allowance must never apply to redirect hops.
        if (!options.allowPrivateRedirects) redirectOptions.allowPrivate = false;
        openUpstream(nextUrl, redirectOptions).then(resolve, fail);
        return;
      }

      // Upstream 4xx/5xx responses are returned so callers can preserve the
      // provider's status code. Detection routes convert them to safe errors.
      var idle = options.idleTimeoutMs || config.idleTimeoutMs;
      idleTimer = setTimeout(function () {
        try { response.destroy(); } catch (e) {}
      }, idle);
      response.on('close', function () {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      });

      settled = true;
      resolve({
        response: response,
        request: request,
        url: target.href,
        validated: validated,
        method: method,
        status: status
      });
    });

    request.on('error', function (err) {
      if (err && err.code && err.status) { fail(err); return; }
      safeLog('upstream', 'connection failed', rawUrl);
      fail(proxyError(502, 'UPSTREAM_UNREACHABLE',
        'The upstream stream could not be reached.'));
    });

    request.setNoDelay && request.setNoDelay(true);
    var headersTimeout = options.headersTimeoutMs || config.headersTimeoutMs;
    headerTimer = setTimeout(function () {
      try { request.destroy(proxyError(504, 'UPSTREAM_TIMEOUT',
        'The upstream stream did not respond in time.')); } catch (e) {}
    }, headersTimeout);

    request.end();
  });
}

module.exports = { openUpstream, pinnedLookup };
