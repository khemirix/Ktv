# Catalog / UI testing

## Automated checks
- `js/app.js`, `js/tmdb.js`, `js/media-player.js`, `js/subtitles.js`, `js/resolver.js`: `node --check` passed.
- jsdom platform test passed for all 9 movie sections, all 8 TV sections, shared 2:3 poster cards, movie/series details, season switching, episode playback, movie playback, quality switching, mixed search with All/Movies/TV Shows filters, and Movies/TV Shows/Live TV navigation.
- Live TMDB checks returned data for every catalog source, both search types, details, seasons and IMDb IDs.

## Manual checks
1. Open `index.html`; confirm the 9 movie rows and backdrop hero.
2. Switch to TV Shows; confirm the 8 series rows, including Anime, and `?tab=tv`.
3. Open a movie card; verify poster, backdrop, year, overview, genres, rating, runtime and Play now.
4. Open a series card; verify season count, season tabs, episode thumbnails, titles, descriptions and runtimes.
5. Switch season, press Play on an episode, and verify SxxEyy resolution.
6. Search a title present in both categories; verify MOVIE/SERIES badges and each filter.
7. Use Live TV; confirm channel filters and playback still work.
8. Repeat at a 390px viewport: rails become two-column grids, arrows hide, details stack.

## Known limitations
- Live TV uses its own `channels.json` + proxy player; only navigation links were changed.
- Recommendations depend on a popular TMDB seed; if TMDB has none, the row is empty but the page still works.
- Real-device visual polish checks on Android Chrome and iPad Safari are still recommended; DOM tests verify behavior, not pixel rendering.
