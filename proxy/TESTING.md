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

Result: **53/53 tests passed** (detection, progressive forwarding, Range/HEAD,
client disconnect, live streams, safe errors, frontend client retry/abort,
health, HLS rewriting, HTTPS HLS, slow headers, DNS classification/retry,
HTTP→HTTPS redirects, nested playlists, security, address fallback, IPv6
fallback, TCP/TLS/header timeout classification, TLS timer lifecycle, bounded
attempts, overall connection deadline, resettable idle timeout, Host/SNI
preservation, safe connection diagnostics, and gated TCP diagnostics including
success, timeout, refusal, DNS failure, invalid input, token/auth failures,
disabled endpoint, and private-address rejection).

Existing website regression command from the repository root:

```bash
node --test tests/*.test.js
```

Result: **9/9 tests passed across 6 files** (stream-detector checks,
live-player checks, media-player quality, app quality flow, player features,
and 4 new Live TV integration assertions). No real provider playback was
performed by the automated suite.

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
| 14 | Slow but working upstream | Point to a mock that delays headers by 250 ms | Detection succeeds with the default 20 s header budget. |
| 15 | Upstream header timeout | Point to a mock that delays headers beyond `HEADERS_TIMEOUT_MS` | HTTP `504` `UPSTREAM_TIMEOUT`; the upstream socket closes. |
| 16 | DNS failure/retry | Point to a hostname that cannot resolve | HTTP `502` `DNS_FAILURE` with safe details after bounded retries. |
| 17 | Upstream connection failure | Point to an unused local port | HTTP `502` `UPSTREAM_UNREACHABLE`. |
| 18 | Client disconnect | Start a long TS stream, then close the browser tab or abort the request | Proxy closes upstream socket; no leak appears in `/health` `activeStreams`. |
| 19 | Long-running live connection | Play a live TS channel for several minutes | First frames arrive immediately; connection stays healthy; no growing memory in the proxy process. |
| 20 | Auth query parameters | Play a tokenized HLS playlist locally | Playlist and segment/key URLs retain query parameters after rewriting; tokens are not logged. |
| 21 | Address fallback | Use a hostname with more than one public DNS record, where one address refuses connections | Detection succeeds on another validated address; failed attempt diagnostics show attempt number, family, and TCP duration without exposing IPs. |
| 22 | VLC compatibility profile | Set `UPSTREAM_USER_AGENT_PROFILE=vlc`, restart, and detect a local mock | Upstream receives `VLC/3.0.21 LibVLC/3.0.21`; Range headers are still preserved. This is only a compatibility probe, not a universal fix. |
| 23 | Continuous live stream | Play a TS channel that sends chunks for longer than 60 seconds | Stream stays connected; the idle timer resets on every chunk and no `STREAM_IDLE_TIMEOUT` occurs. |
| 24 | Genuinely stalled stream | Use a mock that stops sending while holding the socket open | Stream closes after `IDLE_TIMEOUT_MS`; upstream socket is released. |
| 25 | TCP diagnostics disabled | Request `/api/diag/tcp?host=example.test&port=80` without the gate | HTTP `404` even with a token. |
| 26 | TCP diagnostics auth | Enable the gate; request with no/wrong `DIAGNOSTICS_TOKEN` header | HTTP `401`. |
| 27 | TCP diagnostics input | Request with `host=localhost`, `port=70000`, or an extra `url=` parameter | HTTP `400`. |
| 28 | TCP diagnostics SSRF | Inject/return a private address for the host | HTTP `403` `BLOCKED_ADDRESS`; no socket is opened. |
| 29 | TCP diagnostics real probe | Request with only the provider hostname and port | `200` with `ok`, `dnsMs`, `addressCount`, family, timing, `connectEvent`, and error code. No full URL, token, or resolved IP in the response. |

---

## Temporary TCP diagnostics

On Render, set exactly:

```text
ALLOW_TCP_DIAGNOSTICS=true
DIAGNOSTICS_TOKEN=<choose-a-secret>
VERSION=1.4.0
```

Then request:

```bash
curl -sS -H 'DIAGNOSTICS_TOKEN: <secret>' \
  'https://ktv-edmu.onrender.com/api/diag/tcp?host=<provider-hostname>&port=<port>'
```

Send only the hostname and numeric port. Do **not** send a full stream URL,
path, username, password, or query string. After testing, set
`ALLOW_TCP_DIAGNOSTICS=false` or remove both diagnostic variables and redeploy;
the endpoint will return `404`.

---

## Manual Live TV page checks

1. Open `tv.html`. Categories, search, logos, and channel selection must work
   exactly as before. The proxy URL comes only from
   `js/smart-proxy-config.js`.
2. Select an HTTPS channel. Direct detection is attempted first; the Smart
   Proxy is used only if direct detection fails. The Network tab should not
   show `/api/detect` for an HTTPS channel that plays directly.
3. Select an HTTP channel on the HTTPS site. The Network tab must show
   `/api/detect` (then `/api/stream`) and must never show a direct HTTP media
   request. A Mixed Content error must not appear.
4. Open `tv.html?proxy=off`. HTTPS channels use the original direct-detector
   path. Selecting an HTTP channel on HTTPS shows a clear error instead of
   attempting a blocked direct request.
5. `?proxy=http://localhost:10000` can be used for a local backend during
   development; no other file needs editing.
6. Select a known HLS, `.ts`, and extensionless channel. The correct engine
   starts without multiple players being created.
7. Stop/switch channels repeatedly. Previous `/api/detect` and `/api/stream`
   requests are aborted on both client and backend; `activeStreams` returns to
   `0` or a small number.
8. Temporarily stop the proxy and select an HTTP channel on HTTPS. A readable
   proxy error appears (no silent fallback). Select an HTTPS channel: direct
   playback still works.
9. Repeat channel selection in an Android browser. Playback and controls must
   remain unchanged; `AbortController` is feature-detected.
10. Open an existing movie/TV-show page and play one item. Those players must
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
