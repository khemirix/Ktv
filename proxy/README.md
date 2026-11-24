# Khemirix Smart Proxy

An independent, Live-TV-only Node.js backend for Ktv. It detects stream formats,
forwards streams progressively, rewrites HLS playlists, and works with the
existing `LivePlayer` architecture in `tv.html`.

It does **not** touch Movies, TV Shows, `js/media-player.js`, hls.js, mpegts.js,
channel data, or website styling. There is no Tizen support.

---

## 1. Architecture

```text
Browser (tv.html)
  │
  ├─ window.KTV_SMART_PROXY_URL (config; empty = old behavior)
  │
  ├─ js/smart-proxy-client.js ── GET /api/detect?url=... ──▶ Smart Proxy
  │                                                           │
  │                                   validate URL + DNS pin + redirects
  │                                                           │
  │                                            lightweight upstream probe
  │                                                           │
  │◀──────────── detected format + playbackUrl ───────────────┘
  │
  └─ js/live-player.js
       ├─ hls.js     → /api/stream?url=... (rewritten HLS playlists/segments)
       ├─ mpegts.js  → /api/stream?url=... (raw MPEG-TS bytes)
       └─ <video>    → /api/stream?url=... (MP4/WebM/OGG)
```

The proxy never tries to be a general-purpose web proxy. Every URL is validated
before connection, redirects are revalidated, and DNS is pinned to the address
that was checked.

### Repository layout

```text
Ktv/
├── render.yaml              Render Blueprint (rootDir: proxy)
├── tv.html                  Live TV page — only file changed in the frontend
├── js/
│   ├── smart-proxy-client.js  NEW: thin API client, no backend code
│   ├── live-player.js         unchanged
│   └── stream-detector.js     unchanged (fallback path)
├── channels.json            unchanged
└── proxy/
    ├── package.json
    ├── package-lock.json
    ├── server.js
    ├── .env.example
    ├── .gitignore
    ├── README.md             this file
    ├── TESTING.md            manual test guide
    ├── src/
    │   ├── config/
    │   ├── routes/
    │   ├── detectors/
    │   ├── stream/
    │   ├── hls/
    │   ├── security/
    │   ├── middleware/
    │   └── utils/
    └── tests/
```

---

## 2. Install and run locally

Node.js 18 or newer is required. There are no npm runtime dependencies.

```bash
cd proxy
npm install
cp .env.example .env
# edit .env if needed (never commit it)
npm start
```

Health check:

```bash
curl http://localhost:10000/health
```

For development with automatic restart:

```bash
npm run dev
```

`.env` is loaded locally by `src/config/env-file.js`. Real environment variables
always take precedence. On Render, set environment variables in the dashboard;
no `.env` file is needed.

---

## 3. Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `10000` | Listen port. Render supplies this automatically. |
| `HOST` | `0.0.0.0` | Listen address. |
| `VERSION` | `1.0.1` | Reported by `/health`. |
| `SMART_PROXY_PUBLIC_BASE_URL` | derived from request | Public base URL used when rewriting HLS playlist references. Set this on Render. |
| `MAX_URL_LENGTH` | `4096` | Rejects overly long stream URLs. |
| `CONNECT_TIMEOUT_MS` | `8000` | Connection/header timeout budget. |
| `HEADERS_TIMEOUT_MS` | `12000` | Maximum wait for upstream response headers. |
| `IDLE_TIMEOUT_MS` | `30000` | Upstream inactivity timeout for long streams. |
| `DETECT_MAX_BYTES` | `65536` | Max bytes read by detection. Streams are never fully downloaded. |
| `MAX_PLAYLIST_BYTES` | `1048576` | Safety cap for playlist buffering. |
| `PEEK_BYTES` | `16384` | Hint kept for compatibility; forwarding releases the first chunk immediately. |
| `MAX_REDIRECTS` | `5` | Redirect hop limit. Every hop is revalidated. |
| `MAX_CONCURRENT_STREAMS` | `100` | Active `/api/stream` connection limit. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `RATE_LIMIT_MAX` | `120` | Requests per window per client IP. |
| `PROCESSING_ENGINE` | `direct` | `direct` forwards bytes. `ffmpeg` is an explicit placeholder; normal playback never requires it. |
| `LOG_LEVEL` | `info` | Reserved for logging verbosity. |

Never put real IPTV credentials in this file or in deployment logs. The example
file contains placeholders only.

---

## 4. API

All endpoints send `Access-Control-Allow-Origin: *` and expose useful proxy
headers. Errors are JSON with a fixed `code` and safe `message`; upstream URLs,
query strings, headers, and tokens are never echoed.

### `GET /health`

```json
{
  "ok": true,
  "status": "ok",
  "service": "khemirix-smart-proxy",
  "version": "1.0.1",
  "uptimeSeconds": 42,
  "activeStreams": 0,
  "maxStreams": 100,
  "processingEngine": "direct",
  "timestamp": "2026-11-24T12:00:00.000Z"
}
```

### `GET /api/detect?url=STREAM_URL`

Lightweight detection. Reads at most `DETECT_MAX_BYTES`, then aborts the probe.

```json
{
  "ok": true,
  "format": "mpegts",
  "mimeType": "video/mp2t",
  "engine": "mpegts.js",
  "appearsLive": true,
  "proxyStreamingSupported": true,
  "confidence": "high",
  "reason": "content signature",
  "diagnostics": [],
  "status": 200,
  "rangeSupported": false,
  "playlist": null,
  "playbackUrl": "https://proxy.example.onrender.com/api/stream?url=..."
}
```

`format` is one of `hls`, `mpegts`, `mp4`, `webm`, `ogg`, `document`,
`unsupported`, or `unknown`. If the evidence is inconclusive the API returns
`unknown` with a diagnostic instead of guessing.

Optional `&format=HINT` passes existing channel metadata as a low-confidence
hint. It never overrides byte signatures.

### `GET /api/stream/info?url=STREAM_URL`

Returns a safe subset: `contentType`, `detectedFormat`, `status`,
`rangeSupported`, `recommendedEngine`, `appearsLive`, `confidence`, and
`diagnostics`.

### `GET|HEAD /api/stream?url=STREAM_URL`

Progressively forwards the upstream response.

- GET streams bytes as they arrive; no full-file buffering.
- HEAD forwards headers without a body.
- `Range` requests are passed through; `206`/`Content-Range` are preserved
  when the provider supports them.
- Client disconnects destroy the upstream request/response.
- Upstream timeouts, HTTP errors, connection failures, and redirects are
  handled with safe error codes.
- HLS playlists are rewritten before being returned.

Response headers include `X-Proxy-Format`, `X-Proxy-Engine`, `X-Proxy-Via`,
and `Cache-Control: no-store`.

---

## 5. Detection strategy

Detection combines several signals, in order of trust:

1. Initial bytes / container signatures (`#EXTM3U`, MPEG-TS `0x47` packets,
   MP4 `ftyp`, WebM EBML header).
2. `Content-Type` and other response headers.
3. Playlist content (master vs media, `EXT-X-ENDLIST`, encryption, init map).
4. Channel metadata passed via `?format=`.
5. URL extension only as the weakest hint.

Misleading headers are handled by trusting bytes. Extensionless MPEG-TS is
detected from sync bytes, not from the URL. Nothing is downloaded beyond the
small detection prefix, and detection uses a single upstream connection.

---

## 6. HLS handling

When `/api/stream` receives an HLS playlist, it buffers only that small text
playlist (bounded by `MAX_PLAYLIST_BYTES`) and rewrites every reference:

- Plain URI lines: relative segments, absolute segments, nested playlists,
  query parameters, and auth tokens.
- `#EXT-X-KEY:URI="..."`, `#EXT-X-MAP:URI="..."`, `#EXT-X-MEDIA:URI="..."`,
  `#EXT-X-I-FRAME-STREAM-INF:URI="..."`, and session keys.
- Relative references are resolved against the original playlist URL first,
  so nested playlists and tokens keep working.

Important tags and playlist structure are preserved. `Cache-Control: no-store`
prevents live playlist refreshes from being cached. Segments and keys are
fetched through `/api/stream` on demand and forwarded as raw bytes.

---

## 7. MPEG-TS and other formats

MPEG-TS bytes are never modified or buffered to a threshold. The proxy writes
the first received chunk immediately and then pipes with backpressure. This is
important for long-running live channels.

MP4, WebM, and OGG are forwarded unchanged for native HTML5 playback. Unknown
but non-dangerous byte streams can still be forwarded; detection reports them
honestly as `unknown`.

---

## 8. FFmpeg later (not required)

`src/stream/engines.js` exposes `DirectForwardingEngine` and a deliberately
inactive `FfmpegEngine`. The default is direct forwarding. No transcoding is
performed and FFmpeg is not required to install or run the proxy.

Formats that would need remuxing/transcoding in a future engine:

| Input | Browser path | Remux/transcode needed today? |
|---|---|---|
| HLS TS / fMP4 | hls.js | No |
| Raw MPEG-TS | mpegts.js | No |
| MP4 / WebM / OGG | native `<video>` | No |
| HEVC / unsupported audio codec in TS | mpegts.js may fail | Only if the browser cannot decode; future FFmpeg engine |
| RTSP / RTP / other protocols | none | Not supported; out of scope |

---

## 9. Security

- HTTP/HTTPS only; maximum URL length enforced.
- Rejects URL-embedded credentials.
- Blocks loopback, private IPv4/IPv6, link-local, CGNAT, multicast, reserved,
  and cloud metadata ranges.
- DNS resolution is checked and the chosen IP is pinned with a custom `lookup`
  callback, mitigating DNS rebinding.
- Redirect destinations are resolved and revalidated before connecting. For
  tests only, a localhost allowance can be extended to redirects via
  `allowPrivateRedirects`; production never enables it.
- Redirect limit, header timeout, idle timeout, rate limit, and concurrent
  stream limit are configurable.
- Errors are sanitized; logs redact URLs to `protocol//host/<redacted>` and
  never include query strings, tokens, or headers.

This proxy must not be exposed as an unrestricted public proxy. Deploy it with
the validation enabled and keep sensitive provider URLs in the Live TV
configuration, not in the proxy.

---

## 10. Render deployment

The root `render.yaml` is a Blueprint with `rootDir: proxy`, start command
`npm start`, and health path `/health`.

1. Push this branch to GitHub.
2. In Render, create a new **Blueprint** from the repository, or create a
   **Web Service** manually with:
   - Root Directory: `proxy`
   - Build Command: `npm install --omit=dev`
   - Start Command: `npm start`
   - Health Check Path: `/health`
3. Set `SMART_PROXY_PUBLIC_BASE_URL` to the Render service URL, for example
   `https://khemirix-smart-proxy.onrender.com` (no real credentials).
4. Confirm `https://<service>/health` returns `status: ok`.

GitHub Pages remains the website host; it cannot run this Node.js backend.
Website and proxy are deployed independently.

---

## 11. Live TV integration

`tv.html` includes two small Live-TV-only files:

- `js/smart-proxy-config.js` — the single source of truth for the proxy URL.
- `js/smart-proxy-client.js` — the API client; it contains no proxy URL.

Change `DEFAULT_PROXY_URL` in `js/smart-proxy-config.js` when the backend moves.
Runtime overrides without editing code:

```text
https://khemirix.github.io/Ktv/tv.html?proxy=https://another-proxy.example
```

```js
localStorage.setItem('ktvSmartProxyUrl', 'https://another-proxy.example');
```

Use `?proxy=off` (or store `off`) to disable the proxy temporarily.

When enabled:

1. `playChannel()` asks `/api/detect` first with a 30-second timeout so a cold
   Render instance can wake up.
2. The returned `playbackUrl` and engine are passed to the existing
   `LivePlayer`.
3. Original channel data remains available as `originalUrl`/`metadata`.
4. Switching channels aborts the previous detection request and destroys the
   current player before starting a new one.
5. If Smart Proxy detection fails or times out, a visible diagnostic is shown
   and the original `StreamDetector` path is used as a backward-compatible
   fallback.
6. HLS playlists/segments/keys are rewritten by the proxy; the browser never
   receives an unrewritten playlist when proxy mode is active.

To disable the proxy and restore the original behavior, use `?proxy=off` or
clear `localStorage.ktvSmartProxyUrl` and set `DEFAULT_PROXY_URL` to an empty
string. No player logic changes are required.

---

## 12. Testing

```bash
cd proxy
npm test
```

The suite covers detection, HLS master/media/nested/absolute/tokenized
playlists, segments and keys, TS/extensionless TS/MP4, Range, incorrect
Content-Type, unsupported data, invalid URLs, private/metadata IPs, redirects,
timeouts, connection failures, client disconnects, long live streams, redaction,
rate/connection limits, and the frontend client.

Existing website suites also pass from the repository root:

```bash
node --test tests/*.test.js
```

See `proxy/TESTING.md` for the manual test guide and real-provider cautions.

---

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| `/health` fails | Service build/start logs; `PORT` from Render. |
| Detection says `unknown` | Provider returned no bytes/headers in time; raise `DETECT_MAX_BYTES` or `HEADERS_TIMEOUT_MS`. |
| HLS segments 404 | Confirm `SMART_PROXY_PUBLIC_BASE_URL`; check playlist rewrite in browser Network tab. |
| TS starts slowly | Confirm `/api/stream` is used and no old `t-ahg3.onrender.com/fetch` URL remains. |
| 403 `BLOCKED_ADDRESS` | Provider host resolved to private/metadata range; expected security behavior. |
| 504 `UPSTREAM_TIMEOUT` | Provider did not respond within header timeout. |
| 503 `TOO_MANY_STREAMS` | Lower channel switching frequency or raise `MAX_CONCURRENT_STREAMS`. |
| Browser CORS error | Ensure the proxy CORS headers are present; verify the base URL, not a Pages path. |

Never paste full private stream URLs, tokens, or provider responses into issue
reports. Hostnames and safe error codes are enough.

---

## 14. Known limitations

- No real provider/device/iOS/Android playback is claimed here; automated tests
  use local mock streams only.
- Provider-side outages still fail; the proxy reports safe upstream errors.
- Live playlist refreshes are not cached by design.
- FFmpeg transcoding is intentionally not implemented.
- Tizen is out of scope.
