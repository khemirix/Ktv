'use strict';

function mimeOf(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function formatFromContentType(contentType) {
  var mime = mimeOf(contentType);
  if (!mime) return null;
  if (/mpegurl|m3u8/.test(mime)) return 'hls';
  if (mime === 'video/mp2t' || mime === 'video/mpegts' ||
      mime === 'application/vnd.dvb.transport') return 'mpegts';
  if (mime === 'video/mp4' || mime === 'application/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/ogg' || mime === 'application/ogg') return 'ogg';
  if (mime === 'text/html' || mime === 'application/json' ||
      mime === 'text/plain' || mime === 'text/xml') return 'document';
  return null;
}

function formatFromUrl(rawUrl) {
  var path;
  try {
    path = new URL(String(rawUrl)).pathname.toLowerCase();
  } catch (e) {
    path = String(rawUrl || '').split(/[?#]/)[0].toLowerCase();
  }
  if (/\.m3u8$/.test(path)) return 'hls';
  if (/\.ts$/.test(path)) return 'mpegts';
  if (/\.mp4$/.test(path) || /\.m4v$/.test(path)) return 'mp4';
  if (/\.webm$/.test(path)) return 'webm';
  if (/\.ogg$/.test(path) || /\.ogv$/.test(path)) return 'ogg';
  return null;
}

function formatFromMetadata(metadata) {
  if (!metadata) return null;
  var raw = String(metadata.format || metadata.type ||
    metadata.streamType || metadata.mime || '').toLowerCase();
  if (!raw) return null;
  if (/hls|m3u8|mpegurl/.test(raw)) return 'hls';
  if (/mpeg-?ts|mp2t|transport.?stream|(^|[^a-z])ts$/.test(raw)) return 'mpegts';
  if (/mp4/.test(raw)) return 'mp4';
  if (/webm/.test(raw)) return 'webm';
  if (/ogg/.test(raw)) return 'ogg';
  return null;
}

function classifyBytes(input) {
  if (!input || !input.length) return null;
  var bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  var sample = bytes.slice(0, Math.min(bytes.length, 1024))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/^[\s]+/, '');

  if (/^#EXTM3U/.test(sample)) return 'hls';

  if (bytes[0] === 0x47) {
    if (bytes.length >= 189 && bytes[188] === 0x47) return 'mpegts';
    if (bytes.length < 189 && (bytes[1] & 0x80) === 0) return 'mpegts';
  }

  if (bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 &&
      bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (/^<!doctype html|^<html/i.test(sample)) return 'document';
  if (/^FLV/.test(sample)) return 'unsupported';
  return null;
}

function expectedMime(format) {
  return {
    hls: 'application/vnd.apple.mpegurl',
    mpegts: 'video/mp2t',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg'
  }[format] || 'application/octet-stream';
}

function recommendEngine(format) {
  return {
    hls: 'hls.js',
    mpegts: 'mpegts.js',
    mp4: 'native',
    webm: 'native',
    ogg: 'native'
  }[format] || 'unknown';
}

module.exports = {
  mimeOf,
  formatFromContentType,
  formatFromUrl,
  formatFromMetadata,
  classifyBytes,
  expectedMime,
  recommendEngine
};
