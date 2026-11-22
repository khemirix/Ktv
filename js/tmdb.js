var TMDB = (function () {
  var API_KEY = '480d4cc2b31147cee62508f27a445cf2';
  var BASE = 'https://api.themoviedb.org/3';
  var IMG = 'https://image.tmdb.org/t/p/w500';
  var IMG_HD = 'https://image.tmdb.org/t/p/original';

  async function fetchJSON(path, params) {
    params = params || {};
    var url = new URL(BASE + path);
    url.searchParams.set('api_key', API_KEY);
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
    });

    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;
    var res;
    try {
      res = await fetch(url.toString(), { signal: controller ? controller.signal : undefined });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('TMDB request timed out');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error('TMDB error: ' + res.status);
    return await res.json();
  }

  function sortNewest(results, field) {
    return (results || []).slice().sort(function (a, b) {
      return String(b[field] || '') > String(a[field] || '') ? 1 : -1;
    });
  }

  function normalize(item, type) {
    var mediaType = item.media_type || type || (item.first_air_date ? 'tv' : 'movie');
    return {
      id: item.id,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      title: item.title || item.name || '',
      name: item.name || item.title || '',
      overview: item.overview || '',
      media_type: mediaType,
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || item.release_date || '',
      vote_average: item.vote_average || 0,
      vote_count: item.vote_count || 0,
      genre_ids: item.genre_ids || [],
      popularity: item.popularity || 0
    };
  }

  function collection(data, type, newestField) {
    var results = (data && data.results) ? data.results.map(function (i) { return normalize(i, type); }) : [];
    if (newestField) results = sortNewest(results, newestField);
    return { results: results };
  }

  async function search(query, page) {
    if (!query) return { results: [] };
    var data = await fetchJSON('/search/multi', {
      query: query,
      page: page || 1,
      include_adult: false
    });
    return collection(data, null, null);
  }

  async function getMovieById(id) {
    if (!id) return null;
    try {
      var m = await fetchJSON('/movie/' + encodeURIComponent(id), { language: 'en-US' });
      if (!m || m.status_code) return null;
      return {
        id: m.id,
        poster_path: m.poster_path || '',
        backdrop_path: m.backdrop_path || '',
        title: m.title,
        name: m.title,
        overview: m.overview,
        release_date: m.release_date,
        first_air_date: m.release_date,
        vote_average: m.vote_average || 0,
        vote_count: m.vote_count || 0,
        genres: Array.isArray(m.genres) ? m.genres.map(function (g) { return g.name; }) : [],
        runtime: m.runtime ? String(m.runtime) : '',
        media_type: 'movie'
      };
    } catch (e) { return null; }
  }

  async function getTvById(id) {
    if (!id) return null;
    try {
      var t = await fetchJSON('/tv/' + encodeURIComponent(id), { language: 'en-US' });
      if (!t || t.status_code) return null;
      var seasons = Array.isArray(t.seasons) ? t.seasons.filter(function (s) { return s.season_number > 0; }) : [];
      return {
        id: t.id,
        poster_path: t.poster_path || '',
        backdrop_path: t.backdrop_path || '',
        title: t.name,
        name: t.name,
        overview: t.overview,
        release_date: t.first_air_date,
        first_air_date: t.first_air_date,
        vote_average: t.vote_average || 0,
        vote_count: t.vote_count || 0,
        genres: Array.isArray(t.genres) ? t.genres.map(function (g) { return g.name; }) : [],
        runtime: (t.episode_run_time && t.episode_run_time.length) ? String(t.episode_run_time[0]) : '',
        number_of_seasons: t.number_of_seasons || seasons.length,
        seasons: seasons,
        media_type: 'tv'
      };
    } catch (e) { return null; }
  }

  // `type` is optional for backwards compatibility. When provided it avoids
  // a movie/TV ID collision by querying only that endpoint.
  async function getById(id, type) {
    if (!id) return null;
    if (type === 'movie') return getMovieById(id);
    if (type === 'tv') return getTvById(id);
    return (await getMovieById(id)) || (await getTvById(id));
  }

  async function getImdbId(type, tmdbId) {
    if (!tmdbId) return null;
    var path = (type === 'tv' ? '/tv/' : '/movie/') + encodeURIComponent(tmdbId) + '/external_ids';
    try {
      var data = await fetchJSON(path);
      return (data && data.imdb_id) || null;
    } catch (e) { return null; }
  }

  async function getSeason(tmdbTvId, seasonNum) {
    if (!tmdbTvId || !seasonNum) return { episodes: [] };
    try {
      var data = await fetchJSON('/tv/' + encodeURIComponent(tmdbTvId) + '/season/' + encodeURIComponent(seasonNum), { language: 'en-US' });
      return data || { episodes: [] };
    } catch (e) { return { episodes: [] }; }
  }

  // ── Catalog sources ──────────────────────────────────────────────
  async function moviesPopular() {
    return collection(await fetchJSON('/movie/popular', { language: 'en-US', page: 1 }), 'movie', null);
  }
  async function moviesTopRated() {
    return collection(await fetchJSON('/movie/top_rated', { language: 'en-US', page: 1 }), 'movie', null);
  }
  async function tvPopular() {
    return collection(await fetchJSON('/tv/popular', { language: 'en-US', page: 1 }), 'tv', null);
  }
  async function tvTopRated() {
    return collection(await fetchJSON('/tv/top_rated', { language: 'en-US', page: 1 }), 'tv', null);
  }

  // ── New catalog sources used by the redesigned rows ─────────────
  async function trendingMovies() {
    return collection(await fetchJSON('/trending/movie/week', { language: 'en-US' }), 'movie', null);
  }
  async function trendingTv() {
    return collection(await fetchJSON('/trending/tv/week', { language: 'en-US' }), 'tv', null);
  }
  async function moviesRecentlyAdded() {
    return collection(await fetchJSON('/movie/now_playing', { language: 'en-US', page: 1 }), 'movie', 'release_date');
  }
  async function tvRecentlyAdded() {
    return collection(await fetchJSON('/tv/airing_today', { language: 'en-US', page: 1 }), 'tv', 'first_air_date');
  }
  async function discoverMovies(genreId) {
    return collection(await fetchJSON('/discover/movie', {
      language: 'en-US', sort_by: 'popularity.desc', with_genres: genreId, page: 1
    }), 'movie', null);
  }
  async function discoverTv(genreId) {
    return collection(await fetchJSON('/discover/tv', {
      language: 'en-US', sort_by: 'popularity.desc', with_genres: genreId, page: 1
    }), 'tv', null);
  }
  async function tvAnime() {
    var data = await fetchJSON('/discover/tv', {
      language: 'en-US',
      sort_by: 'popularity.desc',
      with_genres: 16,
      with_original_language: 'ja',
      page: 1
    });
    var result = collection(data, 'tv', null);
    if (!result.results.length) return discoverTv(16);
    return result;
  }
  async function moviesRecommended(seedId) {
    if (!seedId) {
      var popular = await moviesPopular();
      seedId = popular.results[0] && popular.results[0].id;
    }
    if (!seedId) return { results: [] };
    return collection(await fetchJSON('/movie/' + encodeURIComponent(seedId) + '/recommendations', {
      language: 'en-US', page: 1
    }), 'movie', null);
  }
  async function tvRecommended(seedId) {
    if (!seedId) {
      var popular = await tvPopular();
      seedId = popular.results[0] && popular.results[0].id;
    }
    if (!seedId) return { results: [] };
    return collection(await fetchJSON('/tv/' + encodeURIComponent(seedId) + '/recommendations', {
      language: 'en-US', page: 1
    }), 'tv', null);
  }

  return {
    IMG: IMG,
    IMG_HD: IMG_HD,
    search: search,
    getById: getById,
    getSeason: getSeason,
    getImdbId: getImdbId,

    moviesPopular: moviesPopular,
    moviesTopRated: moviesTopRated,
    tvPopular: tvPopular,
    tvTopRated: tvTopRated,

    trendingMovies: trendingMovies,
    trendingTv: trendingTv,
    moviesRecentlyAdded: moviesRecentlyAdded,
    tvRecentlyAdded: tvRecentlyAdded,
    discoverMovies: discoverMovies,
    discoverTv: discoverTv,
    tvAnime: tvAnime,
    moviesRecommended: moviesRecommended,
    tvRecommended: tvRecommended
  };
})();
