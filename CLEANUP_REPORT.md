# Khemirix TV — Complete Cleanup Report

## Safety and backup

| Item | Value |
|---|---|
| Branch before cleanup | `Cre` |
| Commit before cleanup | `186d8a28e8de163bf461249015242b804ba8350f` |
| Working tree before cleanup | Clean (0 modified, 0 untracked) |
| Backup tag | `backup/pre-cleanup-186d8a2` |
| Cleanup branch | `cleanup/codebase-refactoring` |
| Destructive commands used | None (`reset --hard`, `clean -fd`, and force pushes were not used) |

The original commit remains on `Cre` and is additionally protected by an annotated tag. Every deletion was performed with `git rm`, so all removed files remain recoverable from Git history.

---

## Original project architecture

Khemirix TV is a static GitHub Pages site with no build step. Before cleanup, the repository contained:

- **Supported app:** `index.html` loading `css/style.css`, `js/tmdb.js`, `js/resolver.js`, hls.js, `js/media-player.js`, `js/subtitles.js`, and `js/app.js`.
- **Live TV:** `tv.html` with an inline HLS/mpegts player and `channels.json`.
- **Superseded player path:** `player.html` + `js/anti-ads.js`, built around Vidking iframes.
- **Legacy app generation:** `js/app-backup.js`, `js/app2.js`, `js/player-modal.js`, `js/tv-remote.js`, `js/tv-focus.js`.
- **Experimental/duplicate code:** `index1.html`, `js/tmdb11.js`, `js/patch-app.js`, `js/hero-carousel.js`, `js/navigation.js`, `js/search.js`, `js/test.js`, `movie-test.html`, `player/player.html`, `Pv`.
- **Duplicate UI styling:** a ~300-line inline `<style>` block in `index.html` in addition to `css/style.css`.

Dependency tracing showed that only `index.html` and `tv.html` were linked entry points. None of the orphaned JS files were loaded by any HTML page or dynamic loader.

---

## Final project architecture

```text
Ktv/
├── index.html                 # Main app: Movies / TV Shows / Search / native player
├── tv.html                    # Live TV
├── channels.json
├── css/
│   ├── style.css              # Single stylesheet, including player styles
│   └── img/{khemirix.png,bein/*}
├── js/
│   ├── tmdb.js
│   ├── resolver.js
│   ├── media-player.js
│   ├── subtitles.js
│   └── app.js
├── movie-test.html            # Preserved dev tool (uncertain)
├── player/player.html         # Preserved IPTV test tool (uncertain)
├── Pv                         # Preserved unreferenced config (uncertain)
├── CATALOG_TESTING.md
├── PLAYBACK_TESTING.md
├── CLEANUP_REPORT.md
├── PROJECT_ARCHITECTURE.md
└── README.md
```

See `PROJECT_ARCHITECTURE.md` for the full module graph and runtime flows.

---

## Files deleted

Every deletion was justified by dependency evidence, not by filename.

| File | Why it was safe to remove |
|---|---|
| `index1.html` | Byte-for-byte duplicate of `index.html`; no inbound link or dynamic loader. |
| `player.html` | Vidking-only embed shell; no inbound link; superseded by the native Febbox/HLS player. |
| `js/anti-ads.js` | Loaded only by `player.html`; default allowlist was `vidking.net`; the same IIFE was duplicated twice. |
| `js/player-modal.js` | Contained only Vidking embed URLs and required a `#playerFrame`/`#playerModal` DOM combination no page provides; not loaded. |
| `js/app-backup.js` | Legacy iframe app with three Vidking URLs; superseded by `app.js`; not loaded. |
| `js/app2.js` | Duplicate `openPlayerModal(src)` stub; not loaded. |
| `js/tmdb11.js` | Older, smaller TMDB clone that declared the same `TMDB` global; not loaded and dangerous if accidentally included. |
| `js/tv-focus.js` | TV key navigation duplicated in `app.js:88-119`; not loaded. |
| `js/tv-remote.js` | Same duplicate navigation plus an iframe player stub; not loaded. |
| `js/patch-app.js` | Patched TMDB methods and `#heroSection` that the active catalog no longer uses; not loaded. |
| `js/hero-carousel.js` | Hard-required `#heroSection`, which exists in no current HTML; not loaded. |
| `js/navigation.js` | Required `.tab`/`.card` DOM absent from active pages; not loaded. |
| `js/search.js` | Reimplemented the resolver pipeline and auto-ran on load; not loaded. |
| `js/test.js` | Three-line console logger with no consumer. |

**Total deleted:** 14 files.

---

## Files modified

| File | Changes |
|---|---|
| `index.html` | Removed the ~300-line inline player stylesheet; moved those rules to `css/style.css`; removed unused jQuery; replaced two inline spacing styles with `.settings-spaced`; replaced inline error-title styling with `.player-error-title`. |
| `tv.html` | Removed unused jQuery; fixed the case-sensitive logo path from `Khemirix.png` to `khemirix.png`. |
| `css/style.css` | Removed unused `--bg-soft`; added all player styles under a dedicated section; reduced `::cue` to one base rule (size/background remain controlled by `app.js`); added `.settings-spaced` and `.player-error-title`. |
| `js/app.js` | Removed unused `episodeName` options, unused `onBeforePlay` hook, and unused `_tvContext.key/seasons/details` fields. |
| `js/tmdb.js` | Removed `getEpisode()`, `moviesNowPlaying()`, `tvAiringToday()`, and their exports after their only consumers were deleted. Renamed the stale compatibility comment. |
| `js/resolver.js` | Removed unused `resolve()` wrapper and `setApiBase()`; kept `getApiBase()` because `subtitles.js` uses it. |
| `js/media-player.js` | Removed unused `resync()` method; kept the documented `kind()` debug helper and all playback/recovery behavior. |
| `js/subtitles.js` | Introduced a provider-agnostic `find()` seam and normalized subtitle descriptors; kept Arabic as the default and preserved the `attach()` API used by `app.js`. |
| `CLEANUP_REPORT.md` | Created; this file. |
| `PROJECT_ARCHITECTURE.md` | Created; documents the final structure and data flows. |

---

## Dependencies removed

| Dependency | Evidence | Result |
|---|---|---|
| jQuery 3.6.0 | Loaded by `index.html` and `tv.html`; no `$(`, `jQuery`, or plugin usage anywhere. Bootstrap 5 bundle is standalone. | Removed from both pages. |
| Vidking iframe stack | `player.html` and three orphaned JS files were its only consumers. | Fully removed. |
| Duplicate hls.js versions | Not removed: `index.html` uses 1.5.17, `tv.html` uses 1.5.7. Left unchanged to avoid altering working Live TV behavior. See recommendations. | Documented, not changed. |

No external runtime dependency required by the active app was removed.

---

## Vidking removal details

A case-insensitive search found Vidking references only in:

- `player.html` (embed URL construction, allowed hosts, comments)
- `js/anti-ads.js` (default allowlist and duplicated helper)
- `js/player-modal.js` (embed URLs)
- `js/app-backup.js` (legacy embed URLs)

All four files were deleted. A post-cleanup search confirmed there are **no Vidking URLs, host allowlists, or embed-call sites in active HTML/JS/CSS**. The strings that remain in this report are historical documentation only.

The native player was untouched: quality selection, subtitle rendering, fullscreen, playback controls, Febbox resolution, movie playback, and TV episode playback all remain in `app.js`, `resolver.js`, `media-player.js`, and `subtitles.js`.

---

## Duplicate and dead code removed

- Deleted the byte-identical `index1.html`.
- Deleted the internally duplicated `js/anti-ads.js` IIFE along with the file.
- Deleted the conflicting `js/tmdb11.js` TMDB implementation.
- Deleted duplicate TV focus/remote handlers, duplicated player-modal openers, and the duplicated resolver pipeline in `js/search.js`.
- Removed dead parameters/state from active code: `episodeName`, `onBeforePlay`, and `_tvContext.key/seasons/details`.
- Removed unused public helpers: `TMDB.getEpisode`, `TMDB.moviesNowPlaying`, `TMDB.tvAiringToday`, `Resolver.resolve`, `Resolver.setApiBase`, and `MediaPlayer.resync`.

---

## CSS cleanup

- Consolidated all player-modal CSS into `css/style.css`; `index.html` no longer contains an inline stylesheet.
- Kept the same selectors, values, and responsive behavior — no redesign was performed.
- Removed unused `--bg-soft` variable.
- Removed the fixed `font-size`/`background` declarations from the static `::cue` rule; the runtime rule injected by `app.js` remains authoritative for subtitle size/background settings.
- Converted repeated inline styles into two reusable classes (`.settings-spaced`, `.player-error-title`).
- Verified that every retained class selector is referenced by active HTML or JS, including dynamically applied classes such as `is-loaded`, `is-skeleton`, `active`, `poster-grid`, `quality-btn`, `ep-*` and `detail-ep-*`.

---

## JavaScript cleanup

- Reduced active JS files from 7 to 5.
- Preserved script load order and all working modules.
- Removed unused globals, wrappers, and options as listed above.
- Kept `MediaPlayer.kind()` because `PLAYBACK_TESTING.md` documents it as a diagnostic aid.
- Made subtitle discovery provider-agnostic without coupling it to playback:
  - `Subtitles.find(meta)` returns `{ url, name, lang, provider }`.
  - `Subtitles.configure({ lang, providers })` is available for a future picker.
  - `Subtitles.attach()` still renders native `<track>` cues and still defaults to Arabic.
- The server-side `Showbox-api` already implements MySubs + `subtitles.website`, SRT→VTT conversion, and caching; no API behavior was changed.

---

## Remaining legacy code

- `index.html` still uses inline `onclick`/`onerror` attributes in generated poster cards. This is part of the current working catalog component and was intentionally preserved.
- `tv.html` still contains its player implementation inline rather than in a separate module. It is isolated and working; extracting it was out of scope for this cleanup.
- The TMDB API key remains client-side. This is standard for the existing static architecture.

---

## Uncertain files preserved

| File | Reason |
|---|---|
| `movie-test.html` | Explicit local development interface with Febbox cookie/API test controls. May still be manually used. |
| `player/player.html` | Standalone IPTV/proxy tool using a different endpoint (`/play/<id>`) from Live TV (`/fetch?url=`). Could be bookmarked. |
| `Pv` | Unreferenced extensionless provider JSON. Could be consumed by a tool outside this repository. |
| `css/img/bein/be_in_mena_sports_04_hd.png` | No current `channels.json` entry, but plausibly reserved for a future channel; low-risk to keep. |
| `.vscode/launch.json` | Harmless local editor configuration. |

---

## Tests performed and results

| Test | Result |
|---|---|
| `git status` before changes | Pass — clean tree, no uncommitted work overwritten. |
| Backup tag creation | Pass — `backup/pre-cleanup-186d8a2` points to the original tree. |
| `node --check` on all remaining JS files | Pass — `JS_SYNTAX_OK`. |
| Local HTML `src`/`href` reference check | Pass — 13 local references checked, none missing. |
| CSS `url()` reference check | Pass — 0 local CSS URL references, none broken. |
| DOM ID consistency check | Pass — 38 `getElementById()` IDs used by JS all exist in `index.html`. |
| `TMDB.*` API consistency check | Pass — every method called by `app.js` is exported by `tmdb.js`. |
| Vidking string search after cleanup | Pass — no active HTML/JS/CSS references remain. |
| Deleted-file reference search | Pass — no remaining local reference to any deleted file. |
| Live API: `GET /api/health` | Pass — `{"ok":true,"febboxAuthConfigured":true}`. |
| Live API: `GET /api/search?type=movie&title=Inception` | Pass — returned results. |
| Live API: `GET /api/subtitles/search?...&lang=ar` | Pass — returned a normalized Arabic VTT descriptor from MySubs. |
| Live API: `GET /api/subtitles/file?url=...` | Pass — HTTP 200, `text/vtt`, 39,303 bytes. |
| Live resolver: `Resolver.resolveMovie({title:'Inception',year:'2010'})` | Pass — returned 5 links, first label `ORG`. |
| Browser panel smoke test | Not available — the in-app browser reported that page control is unavailable in this environment. No browser-driven claim is made. |
| jsdom platform test | Not run — `jsdom` is not installed and no package/dependency was added. Static DOM checks were used instead. |

### Features verified by static/live checks

- Homepage and script/CSS wiring.
- Movie and TV catalog module wiring.
- Search module wiring and filter DOM hooks.
- Details modal DOM hooks.
- Season/episode rendering DOM hooks.
- Native player module wiring, quality list wiring, subtitle setting hooks.
- Live TV page local references and logo path.
- Playback resolver and subtitle API integration.

### Features requiring manual device/browser confirmation

- Actual video playback on Android Chrome and iPad Safari.
- Visual quality/subtitle menu interaction and cue rendering.
- Responsive layout at mobile/tablet/desktop widths.
- Live TV stream playback.
- Search/filter interaction and details-modal visuals.

These are documented in `CATALOG_TESTING.md` and `PLAYBACK_TESTING.md`; they were not claimed as browser-tested here.

---

## Known issues

1. Browser-driven UI testing was unavailable in this environment; manual verification is still required.
2. `index.html` uses hls.js 1.5.17 while `tv.html` uses 1.5.7.
3. `Pv`, `movie-test.html`, and `player/player.html` remain intentionally preserved despite having no active app consumer.
4. The Live TV proxy and Showbox API are external Render services; cold starts or outages still affect those features.
5. The `lang=ar` query parameter now sent by `Subtitles.find()` is ignored by the current API, which already returns Arabic only. It is forward-compatible and harmless.

---

## Recommendations for future development

1. Manually run the checklists in `CATALOG_TESTING.md` and `PLAYBACK_TESTING.md` on Android Chrome and iPad Safari.
2. Decide whether `movie-test.html`, `player/player.html`, and `Pv` can be removed in a second cleanup pass.
3. Align hls.js versions across `index.html` and `tv.html` after confirming Live TV behavior.
4. Extract `tv.html`'s inline player into `js/live-player.js` if Live TV continues to grow.
5. Replace inline `onclick` handlers in generated poster cards with delegated event listeners.
6. When the multi-provider subtitle UI is added, use `Subtitles.configure()` and `Subtitles.find()` rather than reintroducing provider-specific code into `app.js`.
7. Keep the backup tag until the cleanup branch has been deployed and manually verified.
