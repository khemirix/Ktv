// TMDB v3 client wrapper (keeps the `TMDB` global for compatibility with the app)
const TMDB = (function(){
  // Use the provided TMDB API key
  const API_KEY = '480d4cc2b31147cee62508f27a445cf2';
  const BASE = 'https://api.themoviedb.org/3';
  // Image base used by the UI when concatenated with poster_path
  const IMG = 'https://image.tmdb.org/t/p/w500';

  async function fetchJSON(path, params={}){
    const url = new URL(BASE + path);
    url.searchParams.set('api_key', API_KEY);
    Object.entries(params).forEach(([k,v])=>{ if (v !== undefined && v !== null) url.searchParams.set(k, v); });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB network error: ${res.status}`);
    return await res.json();
  }

  async function search(query, page=1){
    if (!query) return { results: [] };
    const data = await fetchJSON('/search/multi', { query, page, include_adult: false });
    if (!data || !data.results) return { results: [] };
    const results = data.results.map(item=>({
      id: item.id,
      poster_path: item.poster_path || '',
      title: item.title || item.name || '',
      name: item.name || item.title || '',
      media_type: item.media_type || (item.first_air_date ? 'tv' : 'movie'),
      release_date: item.release_date || item.first_air_date || ''
    }));
    return { results };
  }

  async function getById(tmdbId){
    if (!tmdbId) return null;
    // Try movie first
    try{
      const m = await fetchJSON(`/movie/${encodeURIComponent(tmdbId)}`, { language: 'en-US' });
      if (m && !m.status_code) return {
        id: m.id,
        poster_path: m.poster_path || '',
        title: m.title,
        name: m.title,
        overview: m.overview,
        release_date: m.release_date,
        genres: Array.isArray(m.genres) ? m.genres.map(g=>g.name) : [],
        runtime: m.runtime ? String(m.runtime) : '',
        media_type: 'movie'
      };
    }catch(e){ /* fallthrough to try TV */ }

    try{
      const t = await fetchJSON(`/tv/${encodeURIComponent(tmdbId)}`, { language: 'en-US' });
      if (t && !t.status_code) return {
        id: t.id,
        poster_path: t.poster_path || '',
        title: t.name,
        name: t.name,
        overview: t.overview,
        release_date: t.first_air_date,
        genres: Array.isArray(t.genres) ? t.genres.map(g=>g.name) : [],
        runtime: t.episode_run_time && t.episode_run_time.length ? String(t.episode_run_time[0]) : '',
        media_type: 'tv'
      };
    }catch(e){ /* no-op */ }

    return null;
  }

  // Fetch a specific TV episode using TMDB tv_id + season + episode
  async function getEpisode(tmdbTvId, season, episode){
    if (!tmdbTvId || !season || !episode) return null;
    try{
      const ep = await fetchJSON(`/tv/${encodeURIComponent(tmdbTvId)}/season/${encodeURIComponent(season)}/episode/${encodeURIComponent(episode)}`, { language: 'en-US' });
      if (!ep || ep.status_code) return null;
      return {
        id: ep.id || `${tmdbTvId}-S${season}E${episode}`,
        series_id: tmdbTvId,
        season: String(season),
        episode: String(episode),
        title: ep.name,
        overview: ep.overview,
        release_date: ep.air_date,
        runtime: ep.runtime ? String(ep.runtime) : '',
        poster_path: ep.still_path || ''
      };
    }catch(e){ return null; }
  }

  // Movie / TV lists
  async function moviesNowPlaying(){ const d = await fetchJSON('/movie/now_playing', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function moviesPopular(){ const d = await fetchJSON('/movie/popular', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function moviesTopRated(){ const d = await fetchJSON('/movie/top_rated', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }

  async function tvAiringToday(){ const d = await fetchJSON('/tv/airing_today', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function tvPopular(){ const d = await fetchJSON('/tv/popular', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }
  async function tvTopRated(){ const d = await fetchJSON('/tv/top_rated', { language: 'en-US', page: 1 }); return { results: d.results || [] }; }

  return {
    IMG, search, getById, getEpisode,
    moviesNowPlaying, moviesPopular, moviesTopRated,
    tvAiringToday, tvPopular, tvTopRated
  };
})();
