'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dnsCallback = require('node:dns');
const { validateUrl } = require('../security/validate-url');
const { config } = require('../config');
const { proxyError } = require('../utils/errors');
const { safeLog } = require('../utils/redact');
const { createIdleGuard } = require('./idle-timeout');

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

function normalLookup(hostname, dnsOptions, callback) {
  dnsCallback.lookup(hostname, dnsOptions, callback);
}

// Node may call a custom lookup with { all: true }. In that case the callback
// must receive an array, otherwise the request fails with ERR_INVALID_IP_ADDRESS.
function pinnedLookup(target) {
  var entries = (Array.isArray(target) ? target : [target]).map(function (entry) {
    return {
      address: String(entry.address),
      family: Number(entry.family) || net.isIP(entry.address)
    };
  }).filter(function (entry) { return !!entry.address && !!entry.family; });

  return function (hostname, dnsOptions, callback) {
    if (!entries.length) {
      callback(new Error('NO_VALIDATED_ADDRESS'));
      return;
    }
    if (dnsOptions && dnsOptions.all) {
      callback(null, entries.map(function (entry) {
        return { address: entry.address, family: entry.family };
      }));
    } else {
      callback(null, entries[0].address, entries[0].family);
    }
  };
}

var RETRYABLE_CODES = {
  CONNECT_TIMEOUT: true,
  TLS_TIMEOUT: true,
  UPSTREAM_TIMEOUT: true,
  UPSTREAM_UNREACHABLE: true
};

function shouldRetry(error) {
  return !!error && !error.noRetry && !!RETRYABLE_CODES[error.code];
}

function describeAttempt(attempt) {
  if (!attempt) return 'connection attempt recorded';
  var parts = ['attempt ' + attempt.attempt + ' IPv' + attempt.family];
  parts.push('dns ' + attempt.dnsMs + 'ms/' + attempt.addressCount + ' address(es)');
  parts.push('tcp ' + (attempt.tcpMs === null ? 'n/a' : attempt.tcpMs + 'ms'));
  parts.push('tls ' + (attempt.tlsMs === null ? 'n/a' : attempt.tlsMs + 'ms'));
  parts.push('headers ' + (attempt.headersMs === null ? 'n/a' : attempt.headersMs + 'ms'));
  parts.push('error ' + (attempt.errorCode || 'none'));
  return parts.join(', ');
}

function attachDiagnostics(error, connection) {
  if (!error) return error;
  error.diagnostics = connection;
  error.details = connection.attempts.length
    ? connection.attempts.map(describeAttempt)
    : ['DNS ' + connection.dnsMs + 'ms, ' + connection.addressCount +
       ' validated address(es), no socket attempt completed.'];
  return error;
}

function attemptConnect(rawUrl, options, validated, address, attemptNumber, dnsMs, addressCount) {
  var method = options.method || 'GET';
  var signal = options.signal;
  var target = validated.url;
  var transport = transportFor(target.protocol);
  var requestStart = Date.now();
  var tcpAt = null;
  var timings = {
    attempt: attemptNumber,
    family: address.family,
    dnsMs: dnsMs,
    addressCount: addressCount,
    tcpMs: null,
    tlsMs: null,
    headersMs: null,
    errorCode: null
  };

  return new Promise(function (resolve, reject) {
    var settled = false;
    var connectTimer = null;
    var tlsTimer = null;
    var headerTimer = null;
    var deadlineTimer = null;
    var idleGuard = null;
    var responseRef = null;
    var onAbort = null;

    function clearConnect() {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    }
    function clearTls() {
      if (tlsTimer) { clearTimeout(tlsTimer); tlsTimer = null; }
    }
    function clearHeader() {
      if (headerTimer) { clearTimeout(headerTimer); headerTimer = null; }
    }
    function clearDeadline() {
      if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    }
    function clearIdle() {
      if (idleGuard) { idleGuard.dispose(); idleGuard = null; }
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
      clearDeadline();
      clearIdle();
      removeAbort();
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      timings.errorCode = (error && error.code) || 'UNKNOWN';
      if (error) error.attemptInfo = timings;
      cleanupAll();
      reject(error);
    }

    function destroyWith(error) {
      try { request.destroy(error); } catch (e) {}
      fail(error);
    }

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
      // The URL hostname is unchanged, so Host and TLS SNI stay correct.
      lookup: validated.pinned ? pinnedLookup(address) : normalLookup
    };
    if (target.protocol === 'https:' && options.rejectUnauthorized === false) {
      // Test-only escape hatch for local self-signed fixtures.
      requestOptions.rejectUnauthorized = false;
    }

    var request = transport.request(target, requestOptions, function (response) {
      responseRef = response;
      timings.headersMs = Date.now() - requestStart;
      clearConnect();
      clearTls();
      clearHeader();
      clearDeadline();

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
        if (redirectsExceeded(options)) {
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
          redirects: (options.redirects || 0) + 1,
          method: redirectMethod(status, method)
        });
        // Single-host address injections must never be reused for another host.
        if (new URL(nextUrl).hostname !== target.hostname) {
          delete redirectOptions.addresses;
        }
        // A localhost-only test allowance must never apply to redirect hops.
        if (!options.allowPrivateRedirects) redirectOptions.allowPrivate = false;
        openUpstream(nextUrl, redirectOptions).then(function (opened) {
          removeAbort();
          resolve(opened);
        }, fail);
        return;
      }

      idleGuard = createIdleGuard(response, options.idleTimeoutMs || config.idleTimeoutMs,
        function () {
          var error = timedError('STREAM_IDLE_TIMEOUT',
            'The upstream stream stopped sending data.');
          try { response.destroy(error); } catch (e) {}
        });

      settled = true;
      resolve({
        response: response,
        request: request,
        url: target.href,
        validated: validated,
        method: method,
        status: status,
        idleGuard: idleGuard,
        attemptTimings: timings
      });
    });

    request.on('socket', function (socket) {
      if (!socket || settled) return;
      if (socket.connecting) {
        connectTimer = setTimeout(function () {
          timings.tcpMs = Date.now() - requestStart;
          destroyWith(timedError('CONNECT_TIMEOUT',
            'The connection to the stream host timed out.'));
        }, options.connectTimeoutMs || config.connectTimeoutMs);
        socket.once('connect', function () {
          tcpAt = Date.now();
          timings.tcpMs = tcpAt - requestStart;
          clearConnect();
          if (target.protocol !== 'https:') clearTls();
        });
        if (target.protocol === 'https:') {
          tlsTimer = setTimeout(function () {
            timings.tlsMs = tcpAt ? Date.now() - tcpAt : null;
            destroyWith(timedError('TLS_TIMEOUT',
              'The secure handshake with the stream host timed out.'));
          }, options.tlsTimeoutMs || config.tlsTimeoutMs);
          socket.once('secureConnect', function () {
            timings.tlsMs = tcpAt ? Date.now() - tcpAt : null;
            clearTls();
          });
        }
      } else {
        tcpAt = Date.now();
        timings.tcpMs = 0;
        clearConnect();
        if (target.protocol === 'https:' && socket.encrypted) {
          timings.tlsMs = 0;
          clearTls();
        }
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
      timings.headersMs = Date.now() - requestStart;
      destroyWith(timedError('UPSTREAM_TIMEOUT',
        'The upstream stream did not respond in time.'));
    }, options.headersTimeoutMs || config.headersTimeoutMs);

    var remaining = Number(options.connectionRemainingMs);
    if (isFinite(remaining) && remaining > 0) {
      deadlineTimer = setTimeout(function () {
        var error = timedError('CONNECTION_DEADLINE_EXCEEDED',
          'The connection deadline was reached before the stream responded.');
        error.noRetry = true;
        destroyWith(error);
      }, remaining);
    }

    request.end();
  });
}

function redirectsExceeded(options) {
  return (options.redirects || 0) >= (options.maxRedirects || config.maxRedirects);
}

async function openUpstream(rawUrl, options) {
  options = options || {};
  var signal = options.signal;
  if (signal && signal.aborted) throw clientClosedError();

  var dnsStart = Date.now();
  var validated = await validateUrl(rawUrl, options);
  var dnsMs = Date.now() - dnsStart;
  if (signal && signal.aborted) throw clientClosedError();

  var addresses = (validated.addresses && validated.addresses.length)
    ? validated.addresses
    : [{ address: validated.address, family: validated.family || 4 }];
  var maxAttempts = Math.min(addresses.length,
    options.maxAddressAttempts || config.maxAddressAttempts);
  var deadlineMs = options.connectionDeadlineMs || config.connectionDeadlineMs;
  var deadlineStart = Date.now();
  var attempts = [];
  var lastError = null;

  for (var index = 0; index < maxAttempts; index += 1) {
    if (signal && signal.aborted) throw clientClosedError();
    var remaining = deadlineMs - (Date.now() - deadlineStart);
    if (remaining <= 0) {
      lastError = timedError('CONNECTION_DEADLINE_EXCEEDED',
        'The connection deadline was reached before a validated address responded.');
      lastError.noRetry = true;
      break;
    }

    try {
      var opened = await attemptConnect(rawUrl,
        Object.assign({}, options, { connectionRemainingMs: remaining }),
        validated, addresses[index], index + 1, dnsMs, addresses.length);
      attempts.push(opened.attemptTimings || null);
      opened.attempts = attempts.filter(Boolean);
      opened.connection = {
        dnsMs: dnsMs,
        addressCount: addresses.length,
        attempts: opened.attempts
      };
      opened.diagnostics = opened.attempts.map(describeAttempt);
      return opened;
    } catch (err) {
      if (err && err.attemptInfo) attempts.push(err.attemptInfo);
      lastError = err;
      if (!shouldRetry(err) || (signal && signal.aborted)) break;
    }
  }

  if (!lastError) {
    lastError = proxyError(502, 'UPSTREAM_UNREACHABLE',
      'The upstream stream could not be reached.');
  }
  var connection = {
    dnsMs: dnsMs,
    addressCount: addresses.length,
    attempts: attempts.filter(Boolean)
  };
  throw attachDiagnostics(lastError, connection);
}

module.exports = { openUpstream, pinnedLookup };
