# Playback testing (MP4 + HLS)

`Resolver.getLinks()` returns mixed formats from Febbox:

| Quality label | URL type | Playback path |
|---|---|---|
| `ORG` | direct `.mp4` (H.264/AAC) | normal HTML5 `<video>` |
| `1080p`, `720p`, `360p`, `4K` | `.m3u8` HLS master playlist | iPad Safari: native HLS; Android Chrome/desktop Chrome: HLS.js |

## Android Chrome

1. Open the app and play any movie (e.g. Inception).
2. Confirm the video starts on the default `ORG` quality.
3. Open the gear menu → choose `1080p` (an HLS link).
4. Confirm:
   - the quality badge changes to `1080p`;
   - playback starts and the timeline moves;
   - Arabic subtitles remain visible and stay in sync after seeking.
5. Open DevTools → Network and confirm requests to `hls.shegu.net/...m3u8` and `...m4s` are `200`/`206` with `Access-Control-Allow-Origin: *`.
6. Open DevTools → Console. Non-fatal HLS warnings are prefixed `[HLS]`. Fatal errors show a message in the player error state.

## iPad Safari

1. Play the same title and select `1080p`.
2. Confirm Safari uses native HLS (`MediaPlayer.kind() === 'native-hls'` in the console if needed). HLS.js should not be instantiated.
3. Confirm fullscreen, seeking, Arabic subtitles, subtitle size/background settings, and quality switching still work.

## Desktop Chrome / Firefox

Same as Android Chrome, but HLS.js is required for `.m3u8` links. Firefox supports MSE and should use HLS.js too.

## Failure simulation

- Disable network after playback starts: HLS.js should log a retry and attempt recovery, then fall back to the direct `ORG` MP4 if recovery fails.
- Block `cdn.jsdelivr.net`: HLS qualities show a clear error and fall back to `ORG`; direct MP4 still works.
- Wait until a signed link expires, then reload without re-resolving: the stream will fail. The app always resolves fresh links when playback starts.

## Known upstream limitations

- Febbox/HLS URLs are signed and short-lived; never cache them outside the current playback session.
- Cloudflare can return `403` for `HEAD` requests on the HLS master playlist. HLS.js uses `GET`, which works and returns `Access-Control-Allow-Origin: *`.
- Some shares may not expose every quality. The quality menu is built from whatever the resolver returns.
- Autoplay can be blocked by the browser. Native controls remain visible so the user can tap play.
