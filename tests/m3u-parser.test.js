'use strict';

// M3U/M3U8 parser checks: metadata, special characters, malformed entries,
// chunked streaming, MIME/header hints, and very large playlists.
// Run with: node tests/m3u-parser.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'm3u-parser.js'), 'utf8');
const context = { URL, TextDecoder, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'm3u-parser.js' });
const M3UParser = context.M3UParser;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('PASS ' + name);
}

const base = 'https://provider.example/live/playlist.m3u8';
const sample = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="café.one" tvg-name="Café & Sports | HD" tvg-logo="https://img.example/café.png" group-title="Sports, News",Café & Sports | HD',
  '#EXTGRP:Premium',
  '#KODIPROP:mimetype=application/vnd.apple.mpegurl',
  '#EXTVLCOPT:http-user-agent=KhemirixTV/1.0',
  'https://cdn.example/live/cafe.m3u8?token=abc,123',
  '#EXTINF:-1 tvg-id="" tvg-name="Malformed, Comma" group-title="Drama"',
  'malformed line with spaces',
  '#UNKNOWN-COMMENT:should be ignored',
  '/absolute/root/stream.ts',
  '#EXTINF:-1,No Attributes',
  '../relative/stream.mp4',
  'http://other.example:8080/account/12345/3634',
  ''
].join('\n');

check('parses EXTINF, EXTGRP, special characters, and quoted commas', () => {
  const channels = M3UParser.parseText(sample, base);
  assert.strictEqual(channels.length, 5);
  assert.strictEqual(channels[0].id, 'café.one');
  assert.strictEqual(channels[0].name, 'Café & Sports | HD');
  assert.strictEqual(channels[0].category, 'Sports, News');
  assert.strictEqual(channels[0].stream, 'https://cdn.example/live/cafe.m3u8?token=abc,123');
  assert.strictEqual(channels[0].mime, 'application/vnd.apple.mpegurl');
  assert.strictEqual(channels[0].headers['User-Agent'], 'KhemirixTV/1.0');
  assert.strictEqual(channels[1].name, 'Malformed, Comma');
  assert.strictEqual(channels[1].stream, 'https://provider.example/live/malformed%20line%20with%20spaces');
  assert.strictEqual(channels[2].stream, 'https://provider.example/absolute/root/stream.ts');
  assert.strictEqual(channels[3].name, 'No Attributes');
  assert.strictEqual(channels[3].stream, 'https://provider.example/relative/stream.mp4');
  assert.strictEqual(channels[4].stream, 'http://other.example:8080/account/12345/3634');
});

check('absolute HTTP URLs and extensionless URLs are preserved', () => {
  const channels = M3UParser.parseText(sample, base);
  assert.strictEqual(channels[0].stream.indexOf('https://cdn.example/live/cafe.m3u8'), 0);
  const bare = M3UParser.parseText('#EXTINF:-1,Extensionless\nhttp://example.com:80/account/12345/3634');
  assert.strictEqual(bare[0].stream, 'http://example.com:80/account/12345/3634');
  assert.strictEqual(bare[0].category, 'Uncategorized');
});

check('parseAttributes handles escaped quotes and duplicate keys', () => {
  const attrs = M3UParser.parseAttributes('tvg-name="A \\"quoted\\" name",group-title="One,Two",tvg-id=second,tvg-id=last');
  assert.strictEqual(attrs.TVGNAME, 'A "quoted" name');
  assert.strictEqual(attrs.GROUPTITLE, 'One,Two');
  assert.strictEqual(attrs.TVGID, 'last');
});

check('streaming parser produces identical results across arbitrary chunk boundaries', () => {
  const expected = M3UParser.parseText(sample, base);
  const emitted = [];
  const parser = M3UParser.createStreamingParser(base, (ch) => emitted.push(ch));
  for (let i = 0; i < sample.length; i += 7) parser.push(sample.slice(i, i + 7));
  parser.end();
  assert.strictEqual(JSON.stringify(emitted), JSON.stringify(expected));
});

check('100,001-entry playlist streams without storing raw text', () => {
  let count = 0;
  let last = null;
  const parser = M3UParser.createStreamingParser('https://provider.example/big.m3u8', (ch) => {
    count += 1;
    last = ch;
  });
  parser.push('#EXTM3U\n');
  for (let i = 0; i < 100001; i += 1) {
    parser.push('#EXTINF:-1 tvg-id="ch' + i + '" group-title="Bulk",Channel ' + i + '\n');
    parser.push('https://provider.example/stream/' + i + '\n');
  }
  parser.end();
  assert.strictEqual(count, 100001);
  assert.strictEqual(last.name, 'Channel 100000');
  assert.strictEqual(last.stream, 'https://provider.example/stream/100000');
});

console.log('m3u parser tests passed (' + passed + ' checks)');
