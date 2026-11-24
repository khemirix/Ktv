'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { isUnsafeIp } = require('./ip');
const { config } = require('../config');
const { proxyError } = require('../utils/errors');

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// dns.lookup runs on libuv's threadpool, so this never blocks the event loop.
// The timeout only stops waiting; a late successful lookup is harmless.
function withTimeout(value, ms, code, message) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(proxyError(504, code, message));
    }, ms);

    Promise.resolve(value).then(function (result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    }, function (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function lookupWithRetry(hostname, options) {
  var timeoutMs = options.dnsTimeoutMs || config.dnsTimeoutMs;
  var retries = typeof options.dnsRetries === 'number'
    ? options.dnsRetries : config.dnsRetries;
  var retryDelayMs = typeof options.dnsRetryDelayMs === 'number'
    ? options.dnsRetryDelayMs : config.dnsRetryDelayMs;
  var lookup = options.dnsLookup || dns.lookup;
  var lastCode = 'DNS_FAILURE';

  for (var attempt = 0; attempt <= retries; attempt += 1) {
    // A second pass with verbatim disabled works around resolvers that return
    // unusable IPv6 records first. All records are still SSRF-validated.
    var verbatim = attempt % 2 === 0;
    try {
      var records = await withTimeout(
        lookup(hostname, { all: true, verbatim: verbatim }),
        timeoutMs,
        'DNS_TIMEOUT',
        'The stream host lookup timed out.'
      );
      if (records && records.length) return records;
      lastCode = 'DNS_FAILURE';
    } catch (err) {
      lastCode = err && err.code === 'DNS_TIMEOUT' ? 'DNS_TIMEOUT' : 'DNS_FAILURE';
    }
    if (attempt < retries && retryDelayMs > 0) await sleep(retryDelayMs);
  }

  var error = proxyError(
    lastCode === 'DNS_TIMEOUT' ? 504 : 502,
    lastCode,
    lastCode === 'DNS_TIMEOUT'
      ? 'The stream host lookup timed out.'
      : 'The stream host could not be resolved.'
  );
  error.details = ['Tried ' + (retries + 1) + ' DNS lookup attempt(s).'];
  throw error;
}

function orderedAddresses(records) {
  var seen = Object.create(null);
  var out = [];
  (records || []).forEach(function (record) {
    if (!record || !record.address) return;
    var address = String(record.address);
    var family = Number(record.family) || net.isIP(address);
    if (!family || seen[family + ':' + address]) return;
    seen[family + ':' + address] = true;
    out.push({ address: address, family: family });
  });
  // IPv4 first keeps existing behavior; IPv6 remains available for failover.
  return out.filter(function (record) { return record.family === 4; })
    .concat(out.filter(function (record) { return record.family === 6; }));
}

async function resolveSafeAddress(hostname, options) {
  options = options || {};
  var injected = null;
  if (options.addressMap && Object.prototype.hasOwnProperty.call(options.addressMap, hostname)) {
    injected = options.addressMap[hostname];
  } else if (Object.prototype.hasOwnProperty.call(options, 'addresses')) {
    injected = options.addresses;
  }

  if (net.isIP(hostname) || injected) {
    var source = injected || [{ address: hostname, family: net.isIP(hostname) }];
    var direct = orderedAddresses(source);
    if (!direct.length) {
      throw proxyError(502, 'DNS_FAILURE', 'The stream host could not be resolved.');
    }
    if (!options.allowPrivate) {
      var directSafe = direct.filter(function (record) { return !isUnsafeIp(record.address); });
      if (!directSafe.length) {
        throw proxyError(403, 'BLOCKED_ADDRESS', 'The stream host is not allowed.');
      }
      direct = directSafe;
    }
    return {
      addresses: direct,
      address: direct[0].address,
      family: direct[0].family,
      pinned: true
    };
  }

  if (options.allowPrivate) {
    return {
      addresses: [{ address: hostname, family: 0 }],
      address: hostname,
      family: 0,
      pinned: false
    };
  }

  var records = await lookupWithRetry(hostname, options);
  var safe = orderedAddresses(records).filter(function (record) {
    return !isUnsafeIp(record.address);
  });
  if (!safe.length) {
    throw proxyError(403, 'BLOCKED_ADDRESS', 'The stream host is not allowed.');
  }
  return {
    addresses: safe,
    address: safe[0].address,
    family: safe[0].family,
    pinned: true
  };
}

async function validateUrl(raw, options) {
  options = options || {};
  if (typeof raw !== 'string') {
    throw proxyError(400, 'INVALID_URL', 'A valid stream URL is required.');
  }
  var value = raw.trim();
  var maxLength = options.maxUrlLength || config.maxUrlLength;
  if (!value || value.length > maxLength) {
    throw proxyError(400, 'INVALID_URL', 'The stream URL is missing or too long.');
  }

  var parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw proxyError(400, 'INVALID_URL', 'The stream URL is malformed.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw proxyError(400, 'INVALID_PROTOCOL', 'Only HTTP and HTTPS stream URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw proxyError(400, 'INVALID_URL', 'URL-embedded credentials are not accepted.');
  }

  var hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw proxyError(400, 'INVALID_URL', 'The stream URL has no host.');
  }

  if (options.allowPrivate && !options.addresses &&
      !(options.addressMap && Object.prototype.hasOwnProperty.call(options.addressMap, hostname)) &&
      !net.isIP(hostname)) {
    return {
      url: parsed,
      address: hostname,
      family: 0,
      addresses: [{ address: hostname, family: 0 }],
      pinned: false,
      safe: false
    };
  }

  var resolved = await resolveSafeAddress(hostname, options);
  return {
    url: parsed,
    address: resolved.address,
    family: resolved.family,
    addresses: resolved.addresses,
    pinned: resolved.pinned,
    safe: !options.allowPrivate
  };
}

module.exports = { validateUrl, resolveSafeAddress, lookupWithRetry };
