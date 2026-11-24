'use strict';

class ProxyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

function proxyError(status, code, message) {
  return new ProxyError(status, code, message);
}

module.exports = { ProxyError, proxyError };
