'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { isUnsafeIp } = require('./ip');
const { config } = require('../config');
const { proxyError } = require('../utils/errors');

async function resolveSafeAddress(hostname, options) {
  if (net.isIP(hostname)) {
    var family = net.isIP(hostname);
    if (isUnsafeIp(hostname)) {
      throw proxyError(403, 'BLOCKED_ADDRESS', 'The stream host is not allowed.');
    }
    return { address: hostname, family: family };
  }

  var records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw proxyError(502, 'DNS_FAILURE', 'The stream host could not be resolved.');
  }
  if (!records || !records.length) {
    throw proxyError(502, 'DNS_FAILURE', 'The stream host could not be resolved.');
  }

  var safe = records.filter(function (record) { return !isUnsafeIp(record.address); });
  if (!safe.length) {
    throw proxyError(403, 'BLOCKED_ADDRESS', 'The stream host is not allowed.');
  }
  return { address: safe[0].address, family: safe[0].family };
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

  if (options.allowPrivate) {
    return {
      url: parsed,
      address: hostname,
      family: net.isIP(hostname) || 0,
      safe: false
    };
  }

  var resolved = await resolveSafeAddress(hostname, options);
  return {
    url: parsed,
    address: resolved.address,
    family: resolved.family,
    safe: true
  };
}

module.exports = { validateUrl, resolveSafeAddress };
