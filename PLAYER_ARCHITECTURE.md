# Player architecture

This document records the baseline playback design and the target design used by the
Netflix-style player refactor. It exists so a future Samsung Tizen AVPlay adapter can
replace the low-level playback engine without rebuilding the interface.

## Baseline (`Cre` @ `a8216b0`)

- `js/app.js` owned playback orchestration, quality selection, subtitles, fullscreen,
  keyboard shortcuts, and all player DOM wiring.
- `js/media-player.js` wrapped HTML5 `<video>` and hls.js, including network-aware
  quality selection, bounded HLS recovery, and direct-MP4 fallback.
- `js/subtitles.js` attached one Arabic subtitle track and applied cue styles.
- `index.html` used native `<video controls>` inside an inline-styled modal.
- The deployed baseline fix automatically picks quality by measured downlink with
  `saveData` taking priority and waits for real playback before showing the active
  quality. That behavior is preserved.

## Target implementation

| Layer | File | Responsibility |
|---|---|---|
| Playback adapter | `js/media-player.js` | HTML5 `<video>`, hls.js/native-HLS/direct-MP4 routing, network estimation, quality fallback, audio-track discovery, listener/timer cleanup. No UI knowledge. |
| Subtitle manager | `js/subtitles.js` | Provider selection, language metadata, native `<track>` lifecycle, cue styling, RTL Arabic cues, cleanup/resync. |
| Playback controller | `js/player-controller.js` | Public playback/state API. Owns selected quality, subtitle lifecycle, audio selection preservation, notices/errors, fullscreen, and event emission. |
| Interface | `js/player-ui.js`, `css/player.css`, `index.html` | Renders controller state, binds controls, keyboard/TV navigation, auto-hide, settings panels, responsive cinematic styling. Calls only the controller API. |
| App shell | `js/app.js` | Catalog, search, detail/episode panels, resolver calls. Supplies metadata to `PlayerController`; no playback implementation remains here. |

## Controller contract

`PlayerController.create({ video, fullscreenElement })` returns:

- Lifecycle: `open(links, title, opts)`, `close()`, `destroy()`, `showError()`, `notice()`
- Transport: `play()`, `pause()`, `togglePlay()`, `seekTo()`, `skip()`, `setVolume()`, `toggleMute()`, `setPlaybackRate()`, `toggleFullscreen()`
- Quality: `selectQuality(index)`, `rememberQuality(on)`
- Audio: `getAudioTracks()`, `getCurrentAudioTrack()`, `setAudioTrack(index)`
- Subtitles: `setSubtitleEnabled()`, `setSubtitleProvider()`, `setSubtitleLanguage()`, `setSubtitleSize()`, `setSubtitleBackground()`, `resyncSubtitles()`
- State/events: `getState()`, `on(event, fn)`, `off(event, fn)`

Events: `statechange`, `timeupdate`, `qualitychange`, `audiochange`, `notice`.

`PlayerUI` subscribes to controller events and never calls `MediaPlayer`, `Resolver`,
`fetch`, or hls.js directly. A future Tizen adapter only needs to satisfy the
`MediaPlayer` adapter surface used by `PlayerController`.

## Audio-track sources of truth

1. hls.js events `AUDIO_TRACKS_UPDATED` and `AUDIO_TRACK_SWITCHED`, with
   `hls.audioTracks` and `hls.audioTrack`.
2. Native `video.audioTracks` when available.
3. Direct MP4 with no exposed metadata: no tracks.

The Audio & Languages menu row is hidden unless `getAudioTracks().length > 1`.
No language is ever synthesized from a filename or quality label. The selected
track is captured before a quality switch and restored by language/label when the
new adapter reports its tracks.

## Subtitle providers

Provider IDs are `auto`, `mysubs`, and `subtitles-website`. The browser calls
`/api/subtitles/search?...&provider=<id>`; the server owns the real integrations.
Languages come only from the provider response (`languages` or `lang`). The API
patch lives outside this repository in `../Showbox-api/api/src/SubtitlesAPI.js`
and `server.js` and must be deployed for forced provider switching on the live site.
