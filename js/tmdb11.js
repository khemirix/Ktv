var TMDB = (function(){
  var API_KEY = '480d4cc2b31147cee62508f27a445cf2';
  var BASE    = 'https://api.themoviedb.org/3';
  var IMG     = 'https://image.tmdb.org/t/p/w500';

  async function fetchJSON(path, params) {
    params = params || {};
    var url = new URL(BASE + path);
    url.searchParams.set('api_key', API_KEY);
    Object.keys(params).forEach(function(k) {
      if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
    });
    var res = await fetch(url.toString());
    if (!res.ok) throw new Error('TMDB error: ' + res.status);
    return await res.json();
  }

  async function search(query, page) {
    if (!query) return { results: [] };
    var data = await fetchJSON('/search/multi', { query: query, page: page || 1, include_adult: false });
    if (!data || !data.results) return { results: [] };
    return {
      results: data.results.map(function(item) {
        return {
          id:           item.id,
          poster_path:  item.poster_path  || '',
          title:        item.title        || item.name || '',
          name:         item.name         || item.title || '',
          overview:     item.overview     || '',
          media_type:   item.media_type   || (item.first_air_date ? 'tv' : 'movie'),
          release_date: item.release_date || item.first_air_date || ''
        };
      })
    };
  }

  async function getById(tmdbId) {
    if (!tmdbId) return null;
    // Try movie first
    try {
      var m = await fetchJSON('/movie/' + encodeURIComponent(tmdbId), { language: 'en-US' });
      if (m && !m.status_code) return {
        id:           m.id,
        poster_path:  m.poster_path  || '',
        title:        m.title,
        name:         m.title,
        overview:     m.overview,
        release_date: m.release_date,
        genres:       Array.isArray(m.genres) ? m.genres.map(function(g){return g.name;}) : [],
        runtime:      m.runtime ? String(m.runtime) : '',
        media_type:   'movie'
      };
    } catch(e) {}
    // Try TV
    try {
      var t = await fetchJSON('/tv/' + encodeURIComponent(tmdbId), { language: 'en-US' });
      if (t && !t.status_code) return {
        id:           t.id,
        poster_path:  t.poster_path  || '',
        title:        t.name,
        name:         t.name,
        overview:     t.overview,
        release_date: t.first_air_date,
        genres:       Array.isArray(t.genres) ? t.genres.map(function(g){return g.name;}) : [],
        runtime:      t.episode_run_time && t.episode_run_time.length ? String(t.episode_run_time[0]) : '',
        media_type:   'tv',
        seasons:      Array.isArray(t.seasons) ? t.seasons : []
      };
    } catch(e) {}
    return null;
  }

  async function getEpisode(tmdbTvId, season, episode) {
    if (!tmdbTvId || !season || !episode) return null;
    try {
      var ep = await fetchJSON(
        '/tv/' + encodeURIComponent(tmdbTvId) +
        '/season/' + encodeURIComponent(season) +
        '/episode/' + encodeURIComponent(episode),
        { language: 'en-US' }
      );
      if (!ep || ep.status_code) return null;
      return {
        id:           ep.id || (tmdbTvId + '-S' + season + 'E' + episode),
        series_id:    tmdbTvId,
        season:       String(season),
        episode:      String(episode),
        title:        ep.name,
        overview:     ep.overview,
        release_date: ep.air_date,
        runtime:      ep.runtime ? String(ep.runtime) : '',
        poster_path:  ep.still_path || ''
      };
    } catch(e) { return null; }
  }

  // Get all episodes for a season
  async function getSeason(tmdbTvId, seasonNum) {
    if (!tmdbTvId || !seasonNum) return { episodes: [] };
    try {
      var data = await fetchJSON('/tv/' + encodeURIComponent(tmdbTvId) + '/season/' + encodeURIComponent(seasonNum), { language: 'en-US' });
      return data || { episodes: [] };
    } catch(e) { return { episodes: [] }; }
  }

  async function moviesNowPlaying() { var d = await fetchJSON('/movie/now_playing', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function moviesPopular()    { var d = await fetchJSON('/movie/popular',      { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function moviesTopRated()   { var d = await fetchJSON('/movie/top_rated',    { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function tvAiringToday()    { var d = await fetchJSON('/tv/airing_today',    { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function tvPopular()        { var d = await fetchJSON('/tv/popular',          { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function tvTopRated()       { var d = await fetchJSON('/tv/top_rated',        { language: 'en-US', page: 1 }); return { results: d.results || [] }; }

  return {
    IMG: IMG,
    search: search,
    getById: getById,
    getEpisode: getEpisode,
    getSeason: getSeason,
    moviesNowPlaying: moviesNowPlaying,
    moviesPopular: moviesPopular,
    moviesTopRated: moviesTopRated,
    tvAiringToday: tvAiringToday,
    tvPopular: tvPopular,
    tvTopRated: tvTopRated
  };
})();
