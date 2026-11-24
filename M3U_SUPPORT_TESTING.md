# Advanced M3U / extensionless stream testing

## Automated checks (actually run)

```bash
cd Ktv
for f in js/*.js tests/*.js; do node --check "$f"; done
node tests/m3u-parser.test.js
node tests/stream-detector.test.js
node tests/live-stream.test.js
node tests/media-player-quality.test.js
node tests/app-quality-flow.test.js
node tests/player-features.test.js
```

Covered automatically:

- `#EXTM3U`, `#EXTINF`, `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `#EXTGRP`.
- Quoted commas, special/Unicode names, HTML entities, malformed entries, bare URL entries.
- Relative/absolute URLs, query tokens kept verbatim, HTTP/HTTPS.
- `#KODIPROP:mimetype=...` and `#EXTVLCOPT:http-user-agent=...` metadata.
- Chunk-boundary streaming parser equivalence and a 100,001-entry playlist.
- MIME classification, HLS/TS/MP4/Matroska byte sniffing, redirects, custom headers.
- Extensionless URLs are **not** forced to HLS: failed detection stays `unknown`, then the native video element is tried before HLS/TS fallbacks.
- Real HLS audio/subtitle track discovery, track setters, and stale-callback cleanup.
- All pre-existing quality, keyboard, subtitle, and error tests still pass.

## Local manual smoke test

Use the checked-in illustrative playlist; it contains no real credentials.

```bash
cd Ktv
python3 -m http.server 8099
```

Open:

- `http://127.0.0.1:8099/tv.html` — load `tests/fixtures/test-playlist.m3u` with **Load File**, or paste a remote playlist URL.
- `http://127.0.0.1:8099/index.html` — movies/TV player with extensionless URL detection.
- `http://127.0.0.1:8099/player/player.html` — standalone proxy player.

Verify in `tv.html`:

1. Built-in `channels.json` list still renders first.
2. Loading the fixture adds the categories and channels from the playlist.
3. Search and category filters work with names containing `&`, `|`, and non-ASCII characters.
4. Each channel card opens the modal without a console exception.
5. Loading a 100k-line local playlist keeps the page responsive; cards appear in batches.
6. Audio selector appears only if the stream exposes more than one real audio track.
7. Subtitle selector appears only if the stream exposes a real subtitle track.
8. Closing the modal stops the stream and clears track selectors.

## Format matrix

| Case | Fixture entry | Automation | Real provider needed |
| --- | --- | --- | --- |
| HLS ending in `.m3u8` | HLS with extension | MIME + extension detection | Yes for playback |
| HLS without extension | `3634` + MIME override | Detector + live adapter tests | Yes for playback |
| MPEG-TS without extension | `3632` + MIME override | Byte sniff + mpegts adapter test | Yes for playback |
| MP4 | Progressive MP4 | Byte sniff + native path test | Yes for playback |
| MKV | Matroska MKV | Byte sniff test | Yes for browser decode |
| Auth tokens/query params | Auth query parameters | Parser preservation test | Yes for live auth |
| HTTP redirect | Redirecting URL | `res.url` final-URL test | Yes for redirect chain |
| Invalid URL | Invalid URL | Malformed entry test | No |
| Unavailable stream | Unavailable stream | Error-path test | No |
| Large playlist | `m3u-parser.test.js` | 100,001 entries | No |

The `example.com` / `test-streams.example` URLs are illustrative. They are intentionally not playable; provider-dependent rows require a real IPTV subscription and must be tested by the user. No private credentials are included in source, fixtures, logs, or commits.

## Known limitations

- This repository is a browser app. There is no AndroidX Media3 / ExoPlayer module or Gradle build here, so an Android build and Media3-specific testing are not applicable.
- Browsers do not allow custom request headers on native `<video src>`; `hls.js` and `mpegts.js` receive configured headers. For other formats, authentication must be supplied by the URL/proxy.
- Native HLS on iOS Safari cannot pass custom headers; use the proxy URL in that case.
- MPEG-TS is decoded with `mpegts.js` where supported; browsers without Media Source Extensions fall back to native video, which may not play raw TS.
- Playlist parsing uses a Web Worker. A browser without Worker support cannot load large playlists (the built-in `channels.json` catalogue still works).
