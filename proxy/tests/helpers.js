'use strict';

const http = require('node:http');
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

function close(server) {
  return new Promise(function (resolve) {
    if (!server || !server.listening) { resolve(); return; }
    server.close(function () { resolve(); });
  });
}

function state() {
  return { requests: [], slowClosed: false, sockets: new Set(), port: 0 };
}

function createUpstreamHandler(s) {
  return function (req, res) {
    var parsed = new URL(req.url || '/', 'http://localhost');
    var path = parsed.pathname;
    s.requests.push(parsed.pathname + parsed.search);

    if (path === '/stream.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(tsBytes());
      return;
    }
    if (path === '/extensionless') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(tsBytes());
      return;
    }
    if (path === '/movie.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(mp4Bytes());
      return;
    }
    if (path === '/unsupported') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>No stream</body></html>');
      return;
    }
    if (path === '/error') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (path === '/range') {
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
    if (path === '/hls/master.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n' +
        'media.m3u8?token=abc\n');
      return;
    }
    if (path === '/hls/media.m3u8' || path === '/hls/live.m3u8') {
      var live = path === '/hls/live.m3u8';
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
    if (path === '/hls/absolute.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4,\n' +
        'http://127.0.0.1:' + s.port + '/hls/seg1.ts?token=abc\n');
      return;
    }
    if (path === '/hls/wrong.m3u8') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('#EXTM3U\n#EXTINF:4,\nseg1.ts\n');
      return;
    }
    if (path === '/hls/incorrect.ts') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(tsBytes());
      return;
    }
    if (path === '/hls/seg1.ts' || path === '/hls/seg2.ts' || path === '/hls/key.bin') {
      res.writeHead(200, { 'Content-Type': path.indexOf('.ts') !== -1 ? 'video/mp2t' : 'application/octet-stream' });
      res.end(tsBytes(188));
      return;
    }
    if (path === '/hls/init.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(mp4Bytes());
      return;
    }
    if (path === '/redirect-private') {
      res.writeHead(302, { Location: 'http://127.0.0.1:' + s.port + '/secret' });
      res.end();
      return;
    }
    if (path === '/redirect-public') {
      res.writeHead(302, { Location: '/stream.ts' });
      res.end();
      return;
    }
    if (path === '/secret') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(tsBytes());
      return;
    }
    if (path === '/slow') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(tsBytes(188));
      s.sockets.add(req.socket);
      req.socket.on('close', function () { s.slowClosed = true; });
      return;
    }
    if (path === '/live') {
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
    if (path === '/never') return;

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

async function startProxy(options) {
  options = options || {};
  var env = Object.assign({
    PORT: '0',
    RATE_LIMIT_MAX: '1000',
    MAX_CONCURRENT_STREAMS: '20',
    HEADERS_TIMEOUT_MS: options.headersTimeoutMs || '12000'
  }, options.env || {});
  var cfg = Object.assign(loadConfig(env), options.config || {});
  var app = createApp({
    config: cfg,
    allowPrivate: options.allowPrivate !== false,
    allowPrivateRedirects: !!options.allowPrivateRedirects
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
  startProxy,
  apiUrl,
  json,
  buffer,
  close
};
