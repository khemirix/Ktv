'use strict';

const { proxyError } = require('./errors');

function streamUrlFrom(params) {
  var value = params && typeof params.get === 'function' ? params.get('url') : '';
  if (!value || !String(value).trim()) {
    throw proxyError(400, 'MISSING_URL', 'The url query parameter is required.');
  }
  return String(value).trim();
}

function publicBaseFromRequest(req, config) {
  if (config && config.publicBaseUrl) {
    return String(config.publicBaseUrl).replace(/\/+$/, '');
  }
  var headers = (req && req.headers) || {};
  var protoHeader = headers['x-forwarded-proto'];
  var host = headers['x-forwarded-host'] || headers.host || 'localhost:10000';
  var hostString = String(host).split(',')[0].trim();
  var proto = protoHeader ? String(protoHeader).split(',')[0].trim() : 'http';
  if (!protoHeader && /onrender\.com/.test(hostString)) proto = 'https';
  return proto + '://' + hostString;
}

module.exports = { streamUrlFrom, publicBaseFromRequest };
