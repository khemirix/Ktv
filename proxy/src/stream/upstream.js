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

function clientClosedError() {
  var error = proxyError(499, 'CLIENT_CLOSED', 'The client closed the request.');
  error.expose = false;
  return error;
}

function timedError(code, message) {
  return proxyError(504, code, message);
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
  var signal = options.signal;

  if (signal && signal.aborted) throw clientClosedError();

  // DNS validation is bounded and retried before any socket is created.
  var validated = await validateUrl(rawUrl, options);
  if (signal && signal.aborted) throw clientClosedError();

  var target = validated.url;
  var transport = transportFor(target.protocol);

  return new Promise(function (resolve, reject) {
    var settled = false;
    var connectTimer = null;
    var tlsTimer = null;
    var headerTimer = null;
    var idleTimer = null;
    var responseRef = null;

    function clearConnect() {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    }
    function clearTls() {
      if (tlsTimer) { clearTimeout(tlsTimer); tlsTimer = null; }
    }
    function clearHeader() {
      if (headerTimer) { clearTimeout(headerTimer); headerTimer = null; }
    }
    function clearIdle() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }
    function removeAbort() {
      if (!signal || !onAbort) return;
      if (typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      } else {
        signal.onabort = null;
      }
      onAbort = null;
    }
    function cleanupAll() {
      clearConnect();
      clearTls();
      clearHeader();
      clearIdle();
      removeAbort();
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanupAll();
      reject(error);
    }

    function destroyWith(error) {
      try { request.destroy(error); } catch (e) {}
      fail(error);
    }

    var onAbort = null;
    if (signal) {
      onAbort = function () {
        if (!settled) fail(clientClosedError());
        cleanupAll();
        try { request.destroy(); } catch (e) {}
        if (responseRef) {
          try { responseRef.destroy(); } catch (e) {}
        }
      };
      if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort);
      } else {
        signal.onabort = onAbort;
      }
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
    if (target.protocol === 'https:' && options.rejectUnauthorized === false) {
      // Test-only escape hatch for local self-signed fixtures.
      requestOptions.rejectUnauthorized = false;
    }

    var request = transport.request(target, requestOptions, function (response) {
      responseRef = response;
      clearConnect();
      clearTls();
      clearHeader();

      if (settled) {
        try { response.destroy(); } catch (e) {}
        return;
      }

      response.on('error', function () {});
      response.once('close', function () {
        clearIdle();
        removeAbort();
      });

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
        openUpstream(nextUrl, redirectOptions).then(function (opened) {
          removeAbort();
          resolve(opened);
        }, fail);
        return;
      }

      // Idle timeout protects live connections without buffering stream data.
      var idleMs = options.idleTimeoutMs || config.idleTimeoutMs;
      idleTimer = setTimeout(function () {
        try {
          response.destroy(timedError('STREAM_IDLE_TIMEOUT',
            'The upstream stream stopped sending data.'));
        } catch (e) {}
      }, idleMs);

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

    request.on('socket', function (socket) {
      if (!socket || settled) return;
      if (socket.connecting) {
        connectTimer = setTimeout(function () {
          destroyWith(timedError('CONNECT_TIMEOUT',
            'The connection to the stream host timed out.'));
        }, options.connectTimeoutMs || config.connectTimeoutMs);
        socket.once('connect', function () {
          clearConnect();
          if (target.protocol !== 'https:') clearTls();
        });
        if (target.protocol === 'https:') {
          tlsTimer = setTimeout(function () {
            destroyWith(timedError('TLS_TIMEOUT',
              'The secure handshake with the stream host timed out.'));
          }, options.tlsTimeoutMs || config.tlsTimeoutMs);
          socket.once('secureConnect', clearTls);
        }
      } else {
        clearConnect();
        if (target.protocol === 'https:' && socket.encrypted) clearTls();
      }
    });

    request.on('error', function (err) {
      if (err && err.status) { fail(err); return; }
      safeLog('upstream', 'connection failed', rawUrl);
      var code = err && err.code;
      var mapped;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        mapped = proxyError(502, 'DNS_FAILURE', 'The stream host could not be resolved.');
      } else if (code === 'ETIMEDOUT') {
        mapped = timedError('CONNECT_TIMEOUT', 'The connection to the stream host timed out.');
      } else {
        mapped = proxyError(502, 'UPSTREAM_UNREACHABLE',
          'The upstream stream could not be reached.');
      }
      fail(mapped);
    });

    request.setNoDelay && request.setNoDelay(true);

    // Overall headers cap. Connect and TLS have their own shorter timers so a
    // slow provider is not reported as a generic timeout.
    headerTimer = setTimeout(function () {
      destroyWith(timedError('UPSTREAM_TIMEOUT',
        'The upstream stream did not respond in time.'));
    }, options.headersTimeoutMs || config.headersTimeoutMs);

    request.end();
  });
}

module.exports = { openUpstream, pinnedLookup };
