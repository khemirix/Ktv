# Khemirix TV — Project Architecture

## Overview

Khemirix TV is a static, no-build front end hosted on GitHub Pages. It has two user-facing entry points:

- `index.html` — movies, TV series, search, details, and the native video player.
- `tv.html` — Live TV channels and stream playback.

There is no bundler, package manager, or server-side component in this repository. The browser loads plain scripts and stylesheets in a fixed order. The backing APIs are external services.

## Final structure

```text
Ktv/
├── index.html                 # Main app: Movies / TV Shows / Search / player
├── tv.html                    # Live TV page with inline HLS/mpegts player
├── channels.json              # Live TV channel list and logos
├── css/
│   ├── style.css              # Shared design system + player styles
│   └── img/
│       ├── khemirix.png       # Main logo
│       └── bein/              # Live TV channel logos
├── js/
│   ├── tmdb.js                # TMDB catalog, search, details, seasons, IMDb IDs
│   ├── resolver.js            # Showbox/Febbox title → share → file → links
│   ├── media-player.js        # HLS.js / native HLS / direct MP4 playback
│   ├── subtitles.js           # Provider-agnostic subtitle discovery + <track>
│   └── app.js                 # UI controller: catalog, details, search, player
├── movie-test.html            # Preserved local API debugging tool
├── player/player.html         # Preserved standalone IPTV/proxy test tool
├── Pv                         # Preserved unreferenced provider list (external use uncertain)
├── CATALOG_TESTING.md
├── PLAYBACK_TESTING.md
├── CLEANUP_REPORT.md
├── PROJECT_ARCHITECTURE.md
└── README.md
```

## Module dependency graph

`index.html` loads scripts in this exact order:

```text
bootstrap.bundle (CDN, standalone)
  → js/tmdb.js
  → js/resolver.js
  → hls.js (CDN)
  → js/media-player.js
  → js/subtitles.js
  → js/app.js
```

Rationale:

- `app.js` calls `TMDB`, `Resolver`, `MediaPlayer`, and `Subtitles`.
- `subtitles.js` reads `Resolver.getApiBase()` when available.
- `media-player.js` uses the global `Hls` supplied by the CDN script.
- Bootstrap 5 does not require jQuery; jQuery was removed from both pages.

`tv.html` is self-contained. It loads Bootstrap, Font Awesome, `css/style.css`, hls.js, and mpegts.js from CDNs, then runs its own inline script against `channels.json`.

## Responsibilities

| Module | Responsibility |
|---|---|
| `js/tmdb.js` | Builds TMDB requests with timeout/error handling; normalizes movie/TV results; supplies trending, popular, recently added, top rated, genre discovery, anime, recommendations, details, seasons, and IMDb external IDs. |
| `js/resolver.js` | Searches Showbox, ranks exact title/year matches, maps IDs to Febbox shares, walks folders for seasons/episodes, selects the best file, and returns quality-labelled stream links. Exposes a friendly unavailable message when no share key exists. |
| `js/media-player.js` | Chooses playback mode per URL: native HLS on Safari/iOS, HLS.js on MSE browsers, direct HTML5 video for MP4/direct URLs. Selects the initial quality from browser connection hints (`networkTier()` / `chooseDefault()`), provides the direct-URL safety net (`fallbackFor()`), and handles HLS lifecycle, retries, and user-facing playback errors. |
| `js/subtitles.js` | Discovers subtitles through the API with a provider-agnostic descriptor (`url`, `name`, `lang`, `provider`), attaches native `<track>` cues, and exposes on/off/resync/destroy controls. Playback code never searches subtitle providers itself. |
| `js/app.js` | Owns application state and DOM. Renders catalog rails/grids, poster cards, details modals, season/episode lists, search results and filters, player controls, quality menu, subtitle settings, and TV remote navigation. |
| `css/style.css` | Single stylesheet: shared tokens, navigation, hero, rails/grids, poster cards, details modal, TV mode, responsive breakpoints, and the native player modal. |
| `tv.html` inline script | Fetches `channels.json`, builds category filters and channel cards, opens the live modal, and selects HLS.js, native HLS, mpegts.js, or direct video per channel. |

## Application flows

### Catalog

1. `app.js` defines `MOVIE_SECTIONS` and `TV_SECTIONS`.
2. `renderContent(tab)` renders skeleton sections immediately.
3. Each section calls a `TMDB.*` method; results are normalized to `{ id, title/name, poster_path, ... }`.
4. Poster cards open `openDetails(key, type)`; the hero opens the details modal for the first trending item.
5. `?tab=tv` selects the TV catalog on load; the Live TV tab navigates to `tv.html`.

### Search

1. `TMDB.search(query)` calls `/search/multi`.
2. Results are filtered to movies and TV shows only.
3. `All / Movies / TV Shows` filters act on the in-memory result list.
4. Cards use the same poster component as the catalog and display a `MOVIE` or `SERIES` badge.

### Movie playback

1. Details modal → Play → `startPlayback(key, 'movie')`.
2. `Resolver.resolveMovie({title, year})` finds the Febbox share and best video file.
3. `playLinks()` asks `MediaPlayer.chooseDefault(links)` for the first quality. Slow/2G/save-data connections start at the lowest quality, medium and unknown connections at up to 720p, and only confidently fast (`4g`/high downlink) connections keep the highest/first link. Manual quality-button clicks override this for the session.
4. `MediaPlayer.create()` is started with that link and a direct-URL fallback, then `Subtitles.attach()` adds Arabic cues by default using TMDB's IMDb external ID.

### Series playback

1. `TMDB.getById(id, 'tv')` supplies seasons; `TMDB.getSeason(id, season)` supplies episodes.
2. Season tabs and episode rows are rendered in both the details modal and the player side panel.
3. `Resolver.resolveEpisode({title, year, season, episode})` walks Febbox folders to the matching file.
4. `playLinks()` is shared with movie playback, so quality, subtitles, fullscreen, and error handling behave identically.

### Live TV

`tv.html` is intentionally independent: it fetches `channels.json`, proxies stream URLs through `https://t-ahg3.onrender.com/fetch?url=...`, and selects the playback engine per stream type.

## Subtitle architecture

The current API already provides multiple free sources server-side:

1. MySubs (Arabic) — primary.
2. `subtitles.website` — fallback.
3. SRT → WebVTT conversion.
4. Six-hour cache and CORS-safe `/api/subtitles/file`.

On the client, `Subtitles.find(meta)` is the single discovery seam. It returns a normalized descriptor and `Subtitles.attach()` renders it as a native text track. `Subtitles.configure({lang, providers})` is reserved for a future language/provider picker; defaults preserve today's Arabic-first behavior. No subtitle logic lives in the playback controller.

## External services

| Service | Used for | Notes |
|---|---|---|
| TMDB | Catalog, details, seasons, IMDb IDs | Public API key in `js/tmdb.js`; standard for this static client. |
| Showbox API (`showbox-api-1.onrender.com`) | Showbox search, Febbox shares/files/links, subtitles | Must be running for playback and subtitles. |
| HLS.js CDN | HLS playback on Chrome/Android | Native HLS is preferred when available. |
| Bootstrap / Font Awesome CDNs | Layout utilities and icons | No local copies. |
| Live TV proxy (`t-ahg3.onrender.com`) | Live stream fetching | Used only by `tv.html` and the preserved IPTV test page. |

## Design system

`css/style.css` is the only stylesheet. It defines shared CSS variables, typography, responsive poster cards (2:3), skeleton loaders, rails/grids, details modal, player modal, and breakpoints at 1200px, 900px, and 640px. Player CSS was consolidated here from an inline block; no visual redesign was performed.

## Deployment notes

- No build command; upload/commit the repository root to GitHub Pages.
- Preserve `index.html` as the site entry point.
- Keep all local `script src` and CSS/image paths relative.
- The Live TV logo path is lowercase (`css/img/khemirix.png`) for case-sensitive hosting.
- `movie-test.html` and `player/player.html` are preserved dev tools, not linked from the main UI. They can be removed in a later cleanup if no longer used.
