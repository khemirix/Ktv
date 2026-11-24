'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startUpstream, startProxy, apiUrl } = require('./helpers');

function uriLines(text) {
  return text.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && line.charAt(0) !== '#');
}

function attrUri(text, tag) {
  const line = text.split(/\r?\n/).find(l => l.indexOf(tag) === 0) || '';
  const match = /URI="([^"]+)"/.exec(line);
  return match ? match[1] : '';
}

test('HLS master, media, nested playlists, segments, key, and init all proxy correctly', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const masterRes = await fetch(apiUrl(proxy.base, '/api/stream',
      upstream.base + '/hls/master.m3u8?token=abc'));
    assert.equal(masterRes.status, 200);
    assert.match(masterRes.headers.get('cache-control'), /no-store/);
    const master = await masterRes.text();
    assert.match(master, /^#EXTM3U/);
    assert.match(master, /#EXT-X-STREAM-INF/);

    const variant = uriLines(master)[0];
    assert.ok(variant.includes('/api/stream?url='), 'variant URL is rewritten through proxy');
    assert.ok(variant.includes('token%3Dabc'), 'auth token is preserved in variant URL');

    const mediaRes = await fetch(variant);
    assert.equal(mediaRes.status, 200);
    const media = await mediaRes.text();
    assert.match(media, /#EXT-X-TARGETDURATION:4/);
    assert.match(media, /#EXTINF:4/);

    const segment = uriLines(media)[0];
    const key = attrUri(media, '#EXT-X-KEY:');
    const map = attrUri(media, '#EXT-X-MAP:');
    assert.ok(segment.includes('/api/stream?url='));
    assert.ok(key.includes('/api/stream?url='));
    assert.ok(map.includes('/api/stream?url='));
    assert.ok(segment.includes('token%3Dabc'));
    assert.ok(key.includes('token%3Dabc'));

    const segmentRes = await fetch(segment);
    assert.equal(segmentRes.status, 200);
    const segBytes = Buffer.from(await segmentRes.arrayBuffer());
    assert.equal(segBytes[0], 0x47, 'proxied segment contains MPEG-TS data');

    const keyRes = await fetch(key);
    assert.equal(keyRes.status, 200);
    assert.ok((await keyRes.arrayBuffer()).byteLength > 0);

    const mapRes = await fetch(map);
    assert.equal(mapRes.status, 200);
    const mapBytes = Buffer.from(await mapRes.arrayBuffer());
    assert.equal(mapBytes.toString('ascii', 4, 8), 'ftyp');

    const keyInUpstream = upstream.requests.some(r => r.startsWith('/hls/key.bin?token=abc'));
    const segInUpstream = upstream.requests.some(r => r.startsWith('/hls/seg1.ts?token=abc'));
    assert.ok(keyInUpstream && segInUpstream, 'upstream received rewritten references with tokens');
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test('absolute segment URLs are rewritten and live playlists stay uncached', async () => {
  const upstream = await startUpstream();
  const proxy = await startProxy();
  try {
    const res = await fetch(apiUrl(proxy.base, '/api/stream',
      upstream.base + '/hls/absolute.m3u8'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /no-store/);
    const text = await res.text();
    const absoluteRef = uriLines(text)[0];
    assert.ok(absoluteRef.includes('/api/stream?url='));
    assert.ok(absoluteRef.includes('127.0.0.1'));

    const segRes = await fetch(absoluteRef);
    assert.equal(segRes.status, 200);
    assert.equal(Buffer.from(await segRes.arrayBuffer())[0], 0x47);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
