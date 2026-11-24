'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const { validateUrl } = require('../security/validate-url');
const { pinnedLookup } = require('../stream/upstream');
const { config } = require('../config');
const { proxyError } = require('../utils/errors');

function key(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function normalizeHost(input, maxUrlLength) {
  if (typeof input !== 'string') {
    throw proxyError(400, 'INVALID_HOST', 'A hostname is required.');
  }
  var value = input.trim().toLowerCase();
  if (!value || value.length > Math.min(253, maxUrlLength)) {
    throw proxyError(400, 'INVALID_HOST', 'The hostname is missing or too long.');
  }
  if (/[\s/?#@]/.test(value) || value.indexOf('://') !== -1) {
    throw proxyError(400, 'INVALID_HOST', 'The hostname must not contain URL syntax.');
  }

  if (value.charAt(0) === '[' && value.charAt(value.length - 1) === ']') {
    var literal = value.slice(1, -1);
    if (!net.isIPv6(literal)) {
      throw proxyError(400, 'INVALID_HOST', 'The IPv6 hostname is invalid.');
    }
    return '[' + literal + ']';
  }

  if (value.charAt(value.length - 1) === '.') {
    value = value.slice(0, -1);
  }
  if (!value) {
    throw proxyError(400, 'INVALID_HOST', 'The hostname is invalid.');
  }

  if (net.isIPv4(value)) return value;

  // Single-label names (localhost, internal service names) are rejected here.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
    throw proxyError(400, 'INVALID_HOST', 'A public DNS hostname or public IP is required.');
  }
  var labels = value.split('.');
  for (var i = 0; i < labels.length; i += 1) {
    if (!labels[i] || labels[i].length > 63 ||
        labels[i].charAt(0) === '-' || labels[i].charAt(labels[i].length - 1) === '-') {
      throw proxyError(400, 'INVALID_HOST', 'The hostname is invalid.');
    }
  }
  return value;
}

function normalizePort(input) {
  var value = typeof input === 'number' ? String(input) : (input || '').trim();
  if (!/^\d{1,5}$/.test(value)) {
    throw proxyError(400, 'INVALID_PORT', 'A port from 1 to 65535 is required.');
  }
  var port = Number(value);
  if (!isFinite(port) || port < 1 || port > 65535) {
    throw proxyError(400, 'INVALID_PORT', 'A port from 1 to 65535 is required.');
  }
  return port;
}

function logAttempt(fields) {
  // Server log only. Hostname and IP are not included in the API response.
  // No URL, query string, header, or token is logged.
  // eslint-disable-next-line no-console
  console.warn('[tcp-diagnostic] ' + JSON.stringify(fields));
}

function connectOnce(host, port, address, timeoutMs, options) {
  var started = Date.now();
  var attempt = {
    family: address.family,
    addressKey: key(address.address),
    tcpMs: null,
    connectEvent: false,
    socketErrorCode: null,
    errorEvent: null
  };

  return new Promise(function (resolve) {
    var settled = false;
    var timer = null;
    var socket = null;

    function finish(code, event) {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (code && !attempt.socketErrorCode) attempt.socketErrorCode = code;
      if (event && !attempt.errorEvent) attempt.errorEvent = event;
      if (attempt.tcpMs === null) attempt.tcpMs = Date.now() - started;
      if (socket) {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        try { socket.destroy(); } catch (e) {}
      }
      resolve({ attempt: attempt, errorCode: code || null, errorEvent: event || null });
    }

    function onConnect() {
      attempt.connectEvent = true;
      attempt.tcpMs = Date.now() - started;
      attempt.errorEvent = 'connect';
      finish(null, null);
    }
    function onError(err) {
      finish((err && err.code) || 'SOCKET_ERROR', 'error');
    }
    function onClose() {
      finish('SOCKET_CLOSED_BEFORE_CONNECT', 'close');
    }

    timer = setTimeout(function () {
      finish('CONNECT_TIMEOUT', 'timeout');
    }, timeoutMs);

    try {
      if (typeof options.connector === 'function') {
        socket = options.connector({
          host: host,
          port: port,
          address: address,
          lookup: pinnedLookup(address)
        });
      } else {
        socket = net.createConnection({
          host: host,
          port: port,
          lookup: pinnedLookup(address),
          family: address.family
        });
      }
      if (!socket || typeof socket.once !== 'function') {
        throw new Error('INVALID_SOCKET');
      }
      socket.setNoDelay && socket.setNoDelay(true);
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.once('close', onClose);
    } catch (err) {
      finish((err && err.code) || 'SOCKET_CREATE_FAILED', 'socket-create');
    }
  });
}

async function diagnoseTcpHost(hostInput, portInput, options) {
  options = options || {};
  var cfg = config;
  var maxUrlLength = options.maxUrlLength || cfg.maxUrlLength;
  var host = normalizeHost(hostInput, maxUrlLength);
  var port = normalizePort(portInput);
  var syntheticUrl = 'http://' + host + ':' + port + '/';
  if (syntheticUrl.length > maxUrlLength) {
    throw proxyError(400, 'INVALID_HOST', 'The hostname is too long.');
  }

  var validationOptions = {
    allowPrivate: false,
    maxUrlLength: maxUrlLength,
    dnsTimeoutMs: options.dnsTimeoutMs || cfg.dnsTimeoutMs,
    dnsRetries: typeof options.dnsRetries === 'number'
      ? options.dnsRetries : cfg.dnsRetries,
    dnsRetryDelayMs: typeof options.dnsRetryDelayMs === 'number'
      ? options.dnsRetryDelayMs : cfg.dnsRetryDelayMs
  };
  // Only explicit test hooks may inject DNS results or addresses. Private
  // addresses are still rejected by validateUrl because allowPrivate is false.
  ['dnsLookup', 'addresses', 'addressMap'].forEach(function (name) {
    if (options.validationOptions &&
        Object.prototype.hasOwnProperty.call(options.validationOptions, name)) {
      validationOptions[name] = options.validationOptions[name];
    }
  });
  validationOptions.allowPrivate = false;

  var dnsStart = Date.now();
  var validated = await validateUrl(syntheticUrl, validationOptions);
  var dnsMs = Date.now() - dnsStart;
  var addresses = (validated.addresses && validated.addresses.length)
    ? validated.addresses
    : [{ address: validated.address, family: validated.family || 4 }];

  var connectTimeoutMs = options.connectTimeoutMs || cfg.connectTimeoutMs;
  var deadlineMs = options.connectionDeadlineMs || cfg.connectionDeadlineMs;
  var requestedAttempts = Math.min(
    Math.max(1, options.maxAddressAttempts || cfg.maxAddressAttempts),
    16
  );
  var maxAttempts = Math.min(addresses.length, requestedAttempts);
  var deadlineStart = Date.now();
  var attempts = [];
  var connected = false;
  var lastErrorCode = null;
  var lastErrorEvent = null;

  for (var index = 0; index < maxAttempts && !connected; index += 1) {
    var remaining = deadlineMs - (Date.now() - deadlineStart);
    if (remaining <= 0) {
      attempts.push({
        attempt: index + 1,
        family: addresses[index].family,
        addressKey: key(addresses[index].address),
        tcpMs: 0,
        connectEvent: false,
        socketErrorCode: 'CONNECTION_DEADLINE_EXCEEDED',
        errorEvent: 'deadline'
      });
      lastErrorCode = 'CONNECTION_DEADLINE_EXCEEDED';
      lastErrorEvent = 'deadline';
      break;
    }

    var outcome = await connectOnce(
      validated.url.hostname,
      port,
      addresses[index],
      Math.min(connectTimeoutMs, remaining),
      options
    );
    var attempt = Object.assign({ attempt: index + 1 }, outcome.attempt);
    attempts.push(attempt);
    logAttempt({
      hostKey: key(validated.url.hostname),
      port: port,
      family: attempt.family,
      address: addresses[index].address,
      attempt: attempt.attempt,
      connectEvent: attempt.connectEvent,
      tcpMs: attempt.tcpMs,
      socketErrorCode: attempt.socketErrorCode,
      errorEvent: attempt.errorEvent
    });

    if (!outcome.errorCode) {
      connected = true;
    } else {
      lastErrorCode = outcome.errorCode;
      lastErrorEvent = outcome.errorEvent || attempt.errorEvent;
    }
  }

  var families = [];
  addresses.forEach(function (address) {
    if (families.indexOf(address.family) === -1) families.push(address.family);
  });

  return {
    ok: connected,
    hostKey: key(validated.url.hostname),
    port: port,
    dnsMs: dnsMs,
    addressCount: addresses.length,
    addressFamilies: families,
    attemptsTried: attempts.length,
    connected: connected,
    errorCode: connected ? null : lastErrorCode,
    errorEvent: connected ? null : lastErrorEvent,
    attempts: attempts
  };
}

module.exports = { diagnoseTcpHost, normalizeHost, normalizePort };
