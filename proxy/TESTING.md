# Khemirix Smart Proxy — Manual testing guide

This guide is for manual verification after `npm test` passes. Automated tests
use local mock servers; this guide distinguishes those results from real
provider playback.

**Never commit or paste real IPTV URLs, tokens, usernames, passwords, or full
provider responses into reports. Record only hostnames, safe error codes, and
timings.**

---

## Setup

```bash
cd proxy
npm install
npm start
```

Confirm the service is up:

```bash
curl http://localhost:10000/health
```

Use safe example URLs such as a public HLS test stream, or use your existing
private channel URLs only on your local machine and redact them in notes.

---

## Automated test results (from this implementation)

Command:

```bash
cd proxy && npm test
```

Result: **18/18 tests passed**.

Existing website regression command from the repository root:

```bash
node --test tests/*.test.js
```

Result: **5/5 suites passed** (32 stream-detector checks, 19 live-player checks,
media-player quality, app quality flow, and player feature suites).

No real provider playback was performed by the automated suite.

---

## Manual API cases

| # | Case | Steps | Expected |
|---:|---|---|---|
| 1 | Standard HLS URL | `GET /api/detect?url=<public-hls-url>` | `format: hls`, `engine: hls.js`, `playbackUrl` present. |
| 2 | HLS master playlist | Request a master `.m3u8` through `/api/stream`, inspect response body | `#EXT-X-STREAM-INF` retained; variant URI starts with the proxy base URL. |
| 3 | HLS media playlist | Request a media `.m3u8` through `/api/stream` | `#EXTINF`, target duration, and tags retained; `#EXT-X-ENDLIST` retained for VOD. |
| 4 | HLS segments + nested playlists | Follow the rewritten variant, then segment/key/map URLs | Every referenced URL is accessible through the proxy; segment bytes start with `0x47` for TS segments. |
| 5 | MPEG-TS `.ts` | Detect and stream a `.ts` URL | `format: mpegts`, `engine: mpegts.js`, bytes forwarded unchanged. |
| 6 | Extensionless MPEG-TS | Use an existing extensionless channel URL locally | Detection still reports `mpegts` from sync bytes, not from URL extension. |
| 7 | MP4 | Detect/stream a `.mp4` URL | `format: mp4`, `engine: native`, bytes forwarded unchanged. |
| 8 | Range requests | `curl -H 'Range: bytes=0-99' .../api/stream?url=<url>` with a Range-capable source | Status `206`, `Content-Range` present, exactly the requested slice returned. |
| 9 | Incorrect Content-Type | Serve HLS/TS bytes with `text/plain` from a local mock | Detection trusts bytes and reports the real format; diagnostic notes the mismatch. |
| 10 | Unsupported format | Point detection at an HTML page | `format: unsupported`, `proxyStreamingSupported: false`, safe message. |
| 11 | Invalid URL | `url=not-a-url`, `ftp://...`, and a missing `url` parameter | HTTP `400` with codes `INVALID_URL`, `INVALID_PROTOCOL`, or `MISSING_URL`. |
| 12 | Private IP rejection | `url=http://127.0.0.1:10000/health` | HTTP `403` `BLOCKED_ADDRESS`. |
| 13 | Redirect to private IP | Use a local mock redirect to `http://127.0.0.1/...` | Redirect is rejected before connection; HTTP `403` `BLOCKED_ADDRESS`. |
| 14 | Upstream timeout | Point to a mock server that never sends headers | HTTP `504` `UPSTREAM_TIMEOUT` after the configured timeout. |
| 15 | Upstream connection failure | Point to an unused local port | HTTP `502` `UPSTREAM_UNREACHABLE`. |
| 16 | Client disconnect | Start a long TS stream, then close the browser tab or abort the request | Proxy closes upstream socket; no leak appears in `/health` `activeStreams`. |
| 17 | Long-running live connection | Play a live TS channel for several minutes | First frames arrive immediately; connection stays healthy; no growing memory in the proxy process. |
| 18 | Auth query parameters | Play a tokenized HLS playlist locally | Playlist and segment/key URLs retain query parameters after rewriting; tokens are not logged. |

---

## Manual Live TV page checks

1. Open `tv.html`. Categories, search, logos, and channel selection must work
   exactly as before. The proxy URL now comes from `js/smart-proxy-config.js`,
   so the loader should mention Smart Proxy on channel selection.
2. Open `tv.html?proxy=off` to confirm the original direct-detector path still
   works with no code changes. `?proxy=http://localhost:10000` can be used for
   a local backend during development.
3. Select a known HLS channel. Loader should mention Smart Proxy, then
   `LIVE`; Network tab should show `/api/detect` followed by `/api/stream`.
4. Select a known `.ts` channel and an extensionless channel locally. The
   correct engine should start without multiple players being created.
5. Stop/switch channels repeatedly. The previous `/api/detect` request should
   be aborted and `activeStreams` should return to `0` or a small number.
6. Temporarily stop the proxy and select a channel. A visible diagnostic should
   appear, then the original detector path should take over.
7. Repeat channel selection in an Android browser. Playback and controls must
   remain unchanged; `AbortController` is feature-detected.
8. Open an existing movie/TV-show page and play one item. Those players must
   remain unchanged.

Movies and TV Shows use `js/media-player.js` and are not routed through this
proxy. Verify their audio-track, quality, and subtitle controls remain
unchanged.

---

## Real provider tests

Only test real IPTV URLs on your local machine with your existing private
configuration. Do not commit them, do not print them in test output, and do not
include them in issue reports. Record only:

- format detected (`hls`, `mpegts`, etc.)
- engine selected
- whether playback started
- safe error code if it failed
- timing (startup delay, buffering events)

Real provider results are separate from the automated results above.
