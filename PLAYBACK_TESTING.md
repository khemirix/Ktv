# Playback testing (MP4 + HLS)

`Resolver.getLinks()` returns mixed formats from Febbox. The API order is **not** trusted.

| Quality label | URL type | Playback path |
|---|---|---|
| `ORG` / `Original` | direct `.mp4` (H.264/AAC) | normal HTML5 `<video>` |
| `1080p`, `720p`, `480p`, `360p`, `4K` | `.m3u8` HLS playlist | iPad Safari: native HLS; Android Chrome/desktop Chrome/Firefox: HLS.js |

## Automatic initial quality

`MediaPlayer.chooseDefault(links, tier)` ranks labels instead of using `links[0]`:

| Network | Initial quality |
|---|---|
| Slow 2G / 2G / Save Data | lowest available labeled quality |
| 3G, or measured downlink 1.5–5 Mbps | best available quality up to 720p |
| 4G with measured downlink ≥ 5 Mbps | highest available labeled quality (usually `ORG`) |
| Unknown / probe failed | conservative fallback up to 720p |

Priority rules:

1. `saveData` always wins.
2. A measured `navigator.connection.downlink` takes priority over `effectiveType`.
3. `effectiveType` is used only when `downlink` is unavailable; `4g` alone is treated as medium, not high.
4. iOS Safari does not expose the Network Information API. The player performs one short, cache-busted fetch of the small local `css/style.css`, times it, and classifies the result. The probe is capped at 1.5 s and cached for 5 minutes; it never downloads a large test file.

The badge shows `Loading <quality>…` until the chosen stream actually starts. Only then does the matching quality button become active. A manual quality click overrides the automatic choice for the current title. Use **Remember quality** in the gear menu to make a quality persistent for future titles; stored preferences are honored only when that label exists in the new link set. If a stored preference does not match, automatic selection is used.

## Android Chrome

1. Open the app and play any movie (e.g. Inception).
2. Confirm the video starts at the network-selected quality, not necessarily the first API link.
3. Open the gear menu → choose a different quality.
4. Confirm:
   - the badge changes to `Loading <quality>…` immediately;
   - the new button becomes active only after playback starts;
   - playback starts and the timeline moves;
   - Arabic subtitles remain visible and stay in sync after seeking.
5. DevTools → Network: confirm requests to `hls.shegu.net/...m3u8` and `...m4s` are `200`/`206` with `Access-Control-Allow-Origin: *`.
6. DevTools → Console: non-fatal HLS warnings are prefixed `[HLS]`. Fatal errors show a message in the player error state and attempt the direct MP4 once.

## iPad Safari

1. Play the same title. Safari uses native HLS for `.m3u8`; HLS.js must not be instantiated.
2. Confirm direct MP4 playback still works when `ORG` is selected.
3. Confirm fullscreen, seeking, Arabic subtitles, subtitle size/background settings, and quality switching still work.
4. If autoplay is blocked, tap the custom play button once. The implementation catches the rejection, shows a hint, and does not retry `play()` in a loop.

## HLS.js initialization and failure behavior

- HLS.js counts as initialized only when `MANIFEST_PARSED` fires. A 12-second watchdog treats a missing manifest as a failure.
- Fatal network errors (`manifestLoadError`, `fragLoadError`, etc.) call `startLoad()` at most twice; fatal media errors call `recoverMediaError()` at most twice.
- After the retry budget, the player shows a meaningful message and switches once to the direct MP4 fallback. A second failure is fatal, so there is no infinite fallback loop.
- If HLS.js fails to load, the player warns and uses the direct MP4 fallback immediately.
- Switching between two direct MP4 qualities preserves `currentTime` where the browser allows it.

## Desktop Chrome / Firefox

Same as Android Chrome. Firefox supports MSE and should use HLS.js for `.m3u8` links.

## Failure simulation

- Disable network after playback starts: HLS.js should log a retry and attempt recovery, then fall back to the direct MP4 once.
- Block `cdn.jsdelivr.net`: HLS qualities show a clear warning and fall back to `ORG`; direct MP4 still works.
- Wait until a signed link expires, then reload without re-resolving: the stream fails with an expiry hint. The app always resolves fresh links when playback starts.

## Custom player controls

The deployed player uses a custom HTML5 UI (`css/player.css`, `js/player-ui.js`) on top of `PlayerController`. There are no native `controls`.

- Mouse/touch: click the timeline to seek; hover for a time preview; drag the volume slider; large buttons for play/pause, ±10 s, mute, fullscreen, subtitles, and settings.
- Keyboard/TV: `Space` play/pause, `←`/`→` seek 10 s, `↑`/`↓` volume, `M` mute, `F` fullscreen, `Escape` closes menus first, then the player. Text inputs are ignored. Settings rows/options are focusable, support Enter/OK, and arrow keys move focus inside the open panel.
- Controls fade out after ~3 s while playing, return on pointer/keyboard/touch activity, and stay visible when paused or while a settings panel is open.
- The gear menu has Quality, Subtitles, subtitle language/provider/size/background, and Playback speed. **Audio & Languages** appears only when the playback adapter reports more than one real selectable track (hls.js `AUDIO_TRACKS_UPDATED` / `AUDIO_TRACK_SWITCHED` / `hls.audioTracks`, or native `video.audioTracks`). Direct MP4 with no metadata never shows the row and never invents languages.

## Subtitle providers

The player asks the Showbox API `/api/subtitles/search` with `provider=auto|mysubs|subtitles-website`. `auto` keeps the original MySubs-first behavior. The local API patch in `../Showbox-api/api/src/SubtitlesAPI.js` and `server.js` adds provider routing and returns `languages` from real provider metadata. The browser only lists languages returned by the API and falls back to `subtitle.lang` when an older deployment omits `languages`. Deploy that API change before expecting forced provider switching on the live site; the current deployed endpoint still ignores `provider`.

## Automated tests

No browser is required for these checks:

```bash
cd Ktv
for f in js/*.js tests/*.js; do node --check "$f"; done
node tests/media-player-quality.test.js
node tests/app-quality-flow.test.js
node tests/player-features.test.js
```

Coverage includes slow-2g, 2g, Save Data, 3g, 4g low/high downlink, unavailable API, fast/slow/failed bandwidth probe, conflicting hints, missing labels, one available quality, different API ordering, manual override, new movie/episode reset, persisted preference, HLS.js unavailable, native HLS, HLS.js initialization, failed manifest/segment requests, direct-source position preservation, audio-track gating and preservation across quality switches, subtitle controls, keyboard shortcuts, control auto-hide, and preserved friendly error messages.

## Known upstream limitations

- Febbox/HLS URLs are signed and short-lived; never cache them outside the current playback session.
- Cloudflare can return `403` for `HEAD` requests on the HLS master playlist. HLS.js uses `GET`, which works and returns `Access-Control-Allow-Origin: *`.
- Some shares may not expose every quality. The quality menu is built from whatever the resolver returns.
- The bandwidth probe is a coarse classifier based on one small same-origin asset; it cannot guarantee a specific sustained throughput.
