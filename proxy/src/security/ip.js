'use strict';

const net = require('node:net');

function ipToInt(value) {
  var parts = String(value).split('.');
  if (parts.length !== 4) return 0;
  var out = 0;
  for (var i = 0; i < 4; i += 1) {
    var part = Number(parts[i]);
    if (!isFinite(part) || part < 0 || part > 255) return 0;
    out = ((out << 8) | part) >>> 0;
  }
  return out;
}

function matchV4(address, base, prefix) {
  var mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipToInt(address) & mask) === (ipToInt(base) & mask);
}

var BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function isUnsafeIpv4(address) {
  return BLOCKED_V4.some(function (range) {
    return matchV4(address, range[0], range[1]);
  });
}

function isUnsafeIpv6(address) {
  var value = String(address || '').toLowerCase();
  if (value === '::' || value === '::1') return true;

  var mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(value);
  if (mapped) {
    var high = parseInt(mapped[1], 16);
    var low = parseInt(mapped[2], 16);
    if (!isNaN(high) && !isNaN(low)) {
      var ipv4 = [high >> 8, high & 255, low >> 8, low & 255].join('.');
      return isUnsafeIpv4(ipv4);
    }
  }

  var dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (dotted) return isUnsafeIpv4(dotted[1]);

  if (/^f[cd]/.test(value)) return true;      // fc00::/7 unique local
  if (/^fe[89ab]/.test(value)) return true;   // fe80::/10 link local
  if (/^ff/.test(value)) return true;        // multicast
  if (/^2001:0?db8/.test(value)) return true; // documentation range
  return false;
}

function isUnsafeIp(address) {
  var value = String(address || '').toLowerCase();
  if (net.isIPv4(value)) return isUnsafeIpv4(value);
  if (net.isIPv6(value)) return isUnsafeIpv6(value);
  return true;
}

module.exports = {
  isUnsafeIp,
  isUnsafeIpv4,
  isUnsafeIpv6
};
