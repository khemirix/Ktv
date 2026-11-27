'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

function tsBytes(size) {
  var length = size || 400;
  var out = Buffer.alloc(length, 0x11);
  for (var i = 0; i < length; i += 188) {
    out[i] = 0x47;
    if (i + 1 < length) out[i + 1] = 0x40;
  }
  return out;
}

function mp4Bytes() {
  return Buffer.from('\x00\x00\x00\x18ftypisom', 'binary');
}

function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function listenOn(server, host, port) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(port, host, function () {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}

function freePort() {
  return new Promise(function (resolve, reject) {
    var probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', function () {
      var port = probe.address().port;
      probe.close(function () { resolve(port); });
    });
  });
}

function close(server) {
  return new Promise(function (resolve) {
    if (!server || !server.listening) { resolve(); return; }
    server.close(function () { resolve(); });
  });
}

function state() {
  return {
    requests: [],
    hosts: [],
    userAgents: [],
    headers: [],
    servernames: [],
    connections: 0,
    slowClosed: false,
    sockets: new Set(),
    port: 0
  };
}

function createUpstreamHandler(s) {
  return function (req, res) {
    var parsed = new URL(req.url || '/', 'http://localhost');
    var pathName = parsed.pathname;
    s.requests.push(parsed.pathname + parsed.search);
    s.hosts.push(req.headers.host || '');
    s.userAgents.push(req.headers['user-agent'] || '');
    s.headers.push(req.headers);

    if (pathName === '/stream.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(tsBytes());
      return;
    }
    if (pathName === '/extensionless') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(tsBytes());
      return;
    }
    if (pathName === '/movie.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(mp4Bytes());
      return;
    }
    if (pathName === '/unsupported') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>No stream</body></html>');
      return;
    }
    if (pathName === '/error') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (pathName === '/range') {
      var body = Buffer.alloc(100, 0x47);
      var match = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!match) {
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Accept-Ranges': 'bytes' });
        res.end(body);
        return;
      }
      var start = Number(match[1]);
      var end = Math.min(Number(match[2]), body.length - 1);
      res.writeHead(206, {
        'Content-Type': 'video/mp2t',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + body.length,
        'Accept-Ranges': 'bytes'
      });
      res.end(body.slice(start, end + 1));
      return;
    }
    if (pathName === '/hls/master.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n' +
        'media.m3u8?token=abc\n');
      return;
    }
    if (pathName === '/hls/nested.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=900000\n' +
        'variant.m3u8?token=abc\n');
      return;
    }
    if (pathName === '/hls/variant.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end([
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MAP:URI="init.mp4?token=abc"',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?token=abc"',
        '#EXTINF:4,',
        'seg1.m4s?token=abc',
        '#EXTINF:4,',
        'seg2.m4s?token=abc',
        '#EXT-X-ENDLIST',
        ''
      ].join('\n'));
      return;
    }
    if (pathName === '/hls/media.m3u8' || pathName === '/hls/live.m3u8') {
      var live = pathName === '/hls/live.m3u8';
      var playlist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MAP:URI="init.mp4?token=abc"',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?token=abc"',
        '#EXTINF:4,',
        'seg1.ts?token=abc',
        '#EXTINF:4,',
        'seg2.ts?token=abc'
      ];
      if (!live) playlist.push('#EXT-X-ENDLIST');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(playlist.join('\n') + '\n');
      return;
    }
    if (pathName === '/hls/absolute.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4,\n' +
        'http://127.0.0.1:' + s.port + '/hls/seg1.ts?token=abc\n');
      return;
    }
    if (pathName === '/hls/chunked.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.write('#EXT');
      setTimeout(function () {
        if (!res.destroyed) res.end('M3U\n#EXTINF:4,\nseg1.ts?token=abc\n');
      }, 10);
      return;
    }
    if (pathName === '/hls/range.m3u8') {
      var playlist = '#EXTM3U\n#EXTINF:4,\nseg1.ts?token=abc\n';
      var body = Buffer.from(playlist);
      var range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (range) {
        var start = Number(range[1]);
        var end = Math.min(Number(range[2]), body.length - 1);
        res.writeHead(206, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Content-Range': 'bytes ' + start + '-' + end + '/' + body.length,
          'Accept-Ranges': 'bytes'
        });
        res.end(body.slice(start, end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(body);
      return;
    }
    if (pathName === '/hls/wrong.m3u8') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('#EXTM3U\n#EXTINF:4,\nseg1.ts\n');
      return;
    }
    if (pathName === '/hls/incorrect.ts') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(tsBytes());
      return;
    }
    if (pathName === '/hls/seg1.ts' || pathName === '/hls/seg2.ts' ||
        pathName === '/hls/seg1.m4s' || pathName === '/hls/seg2.m4s' ||
        pathName === '/hls/key.bin') {
      res.writeHead(200, {
        'Content-Type': pathName.indexOf('.m4s') !== -1
          ? 'video/mp4'
          : (pathName.indexOf('.ts') !== -1 ? 'video/mp2t' : 'application/octet-stream')
      });
      res.end(tsBytes(188));
      return;
    }
    if (pathName === '/hls/init.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(mp4Bytes());
      return;
    }
    if (pathName === '/redirect-private') {
      res.writeHead(302, { Location: 'http://127.0.0.1:' + s.port + '/secret' });
      res.end();
      return;
    }
    if (pathName === '/redirect-public') {
      res.writeHead(302, { Location: '/stream.ts' });
      res.end();
      return;
    }
    if (pathName === '/redirect-https') {
      if (!s.httpsBase) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('https fixture unavailable');
        return;
      }
      res.writeHead(302, { Location: s.httpsBase + '/stream.ts' });
      res.end();
      return;
    }
    if (pathName === '/secret') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(tsBytes());
      return;
    }
    if (pathName === '/slow') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(tsBytes(188));
      s.sockets.add(req.socket);
      req.socket.on('close', function () { s.slowClosed = true; });
      return;
    }
    if (pathName === '/slow-headers') {
      var delay = Number(parsed.searchParams.get('delay') || 300);
      s.sockets.add(req.socket);
      req.socket.on('close', function () { s.slowClosed = true; });
      setTimeout(function () {
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end(tsBytes());
      }, delay);
      return;
    }
    if (pathName === '/live') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(tsBytes(188));
      var timer = setInterval(function () {
        if (!res.destroyed) res.write(Buffer.from([0x47, 0x40, 0x00, 0x11]));
      }, 50);
      s.sockets.add(req.socket);
      req.socket.on('close', function () {
        clearInterval(timer);
        s.slowClosed = true;
      });
      return;
    }
    if (pathName === '/stall') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(tsBytes(188));
      s.sockets.add(req.socket);
      req.socket.on('close', function () { s.slowClosed = true; });
      setTimeout(function () {
        if (!res.destroyed) res.write(Buffer.from([0x47, 0x40, 0x00, 0x11]));
      }, 100);
      // Then stop sending while the socket stays open.
      return;
    }
    if (pathName === '/never') return;

    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('unknown test route');
  };
}

async function startUpstream() {
  var s = state();
  var server = http.createServer(createUpstreamHandler(s));
  s.port = await listen(server);
  s.base = 'http://127.0.0.1:' + s.port;
  s.close = function () { return close(server); };
  return s;
}

async function startHttpsUpstream() {
  var s = state();
  var fixtureDir = path.join(__dirname, 'fixtures');
  var credentials = {
    key: fs.readFileSync(path.join(fixtureDir, 'localhost.key')),
    cert: fs.readFileSync(path.join(fixtureDir, 'localhost.crt'))
  };
  var server = https.createServer(credentials, createUpstreamHandler(s));
  server.on('secureConnection', function (socket) {
    s.servernames.push(socket.servername || '');
  });
  s.port = await listen(server);
  s.base = 'https://localhost:' + s.port;
  s.httpsBase = s.base;
  s.close = function () { return close(server); };
  return s;
}

// Two servers on the same port, bound to different loopback addresses. The
// first can be made to fail/hold; the second succeeds. Useful for address
// fallback tests without relying on external DNS.
async function startFallbackServers(options) {
  options = options || {};
  var port = await freePort();
  var first = state();
  first.port = port;
  var firstServer = http.createServer(function (req, res) {
    first.requests.push(req.url || '/');
    first.hosts.push(req.headers.host || '');
    if (options.first === 'hold') {
      first.sockets.add(req.socket);
      return;
    }
    if (options.first === 'redirect') {
      res.writeHead(302, { Location: 'http://other.test:' + port + '/stream.ts' });
      res.end();
      return;
    }
    req.socket.destroy();
  });
  firstServer.on('connection', function (socket) {
    first.connections += 1;
    socket.on('close', function () { first.slowClosed = true; });
  });
  await listenOn(firstServer, '127.0.0.1', port);

  var second = state();
  second.port = port;
  var secondServer = http.createServer(createUpstreamHandler(second));
  secondServer.on('connection', function () { second.connections += 1; });
  await listenOn(secondServer, options.secondHost || '127.0.0.2', port);

  return {
    port: port,
    first: first,
    second: second,
    base: 'http://stream.test:' + port,
    firstServer: firstServer,
    secondServer: secondServer,
    close: async function () {
      await close(firstServer);
      await close(secondServer);
    }
  };
}

// Accepts TCP connections but never completes a TLS handshake.
async function startTlsSink() {
  var s = state();
  var server = net.createServer(function (socket) {
    s.connections += 1;
    s.sockets.add(socket);
    socket.on('close', function () { s.slowClosed = true; });
  });
  var address = await listenOn(server, '127.0.0.1', 0);
  s.port = address.port;
  s.base = 'https://stream.test:' + s.port;
  s.close = async function () {
    s.sockets.forEach(function (socket) { socket.destroy(); });
    await close(server);
  };
  return s;
}

async function startProxy(options) {
  options = options || {};
  var env = Object.assign({
    PORT: '0',
    RATE_LIMIT_MAX: '1000',
    MAX_CONCURRENT_STREAMS: '20',
    DNS_TIMEOUT_MS: '500',
    DNS_RETRIES: '0',
    HEADERS_TIMEOUT_MS: options.headersTimeoutMs || '12000'
  }, options.env || {});
  var cfg = Object.assign(loadConfig(env), options.config || {});
  var app = createApp({
    config: cfg,
    allowPrivate: options.allowPrivate !== false,
    allowPrivateRedirects: !!options.allowPrivateRedirects,
    requestOptions: options.requestOptions || {},
    tcpDiagnosticsValidationOptions: options.tcpDiagnosticsValidationOptions || null,
    tcpDiagnosticsConnector: options.tcpDiagnosticsConnector || null
  });
  var port = await listen(app.server);
  return {
    app: app,
    config: cfg,
    port: port,
    base: 'http://127.0.0.1:' + port,
    close: function () { return close(app.server); }
  };
}

function apiUrl(proxyBase, endpoint, upstreamUrl, extra) {
  var query = 'url=' + encodeURIComponent(upstreamUrl);
  if (extra) query += '&' + extra;
  return proxyBase + endpoint + '?' + query;
}

async function json(url, options) {
  var response = await fetch(url, options);
  var body = await response.json();
  return { status: response.status, headers: response.headers, body: body };
}

async function buffer(url, options) {
  var response = await fetch(url, options);
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer())
  };
}

module.exports = {
  tsBytes,
  mp4Bytes,
  startUpstream,
  startHttpsUpstream,
  startFallbackServers,
  startTlsSink,
  startProxy,
  apiUrl,
  json,
  buffer,
  close
};
