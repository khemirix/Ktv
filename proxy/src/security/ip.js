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

// Expand an IPv6 literal into eight 16-bit groups. Dotted IPv4 tails are
// converted so embedded IPv4 forms cannot bypass the IPv4 checks.
function ipv6Groups(address) {
  var value = String(address || '').toLowerCase().split('%')[0];
  if (value.indexOf('.') !== -1) {
    var lastColon = value.lastIndexOf(':');
    if (lastColon === -1) return null;
    var dotted = value.slice(lastColon + 1);
    if (!net.isIPv4(dotted)) return null;
    var octets = dotted.split('.').map(Number);
    value = value.slice(0, lastColon + 1) +
      (((octets[0] << 8) | octets[1]).toString(16)) + ':' +
      (((octets[2] << 8) | octets[3]).toString(16));
  }

  var halves = value.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [];
  var tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length >= 8) return null;

  var groups = halves.length === 2
    ? head.concat(new Array(8 - head.length - tail.length).fill(0), tail)
    : head;
  if (groups.length !== 8) return null;

  var parsed = [];
  for (var i = 0; i < groups.length; i += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    parsed.push(parseInt(groups[i], 16));
  }
  return parsed;
}

function embeddedIpv4(groups) {
  return [
    (groups[6] >> 8) & 255,
    groups[6] & 255,
    (groups[7] >> 8) & 255,
    groups[7] & 255
  ].join('.');
}

function isUnsafeIpv6(address) {
  var value = String(address || '').toLowerCase();
  if (value === '::' || value === '::1') return true;

  var groups = ipv6Groups(value);
  if (!groups) return true;

  var firstFiveZero = groups.slice(0, 5).every(function (group) {
    return group === 0;
  });

  // ::/96 includes unspecified, loopback, and deprecated IPv4-compatible
  // forms such as ::127.0.0.1 and ::7f00:1. Treat the whole prefix as unsafe.
  if (firstFiveZero && groups[5] === 0) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and translated (::ffff:0:a.b.c.d) forms must
  // be checked against the IPv4 ranges.
  var translated = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
    groups[3] === 0 && groups[4] === 0xffff && groups[5] === 0;
  if ((firstFiveZero && groups[5] === 0xffff) || translated) {
    return isUnsafeIpv4(embeddedIpv4(groups));
  }

  // Tunnelled IPv6 prefixes can bypass IPv4-only filters.
  if (groups[0] === 0x2002) return true;                 // 6to4
  if (groups[0] === 0x2001 && groups[1] === 0) return true; // Teredo

  if ((groups[0] & 0xfe00) === 0xfc00) return true;      // fc00::/7 ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true;      // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true;      // ff00::/8 multicast
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
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
