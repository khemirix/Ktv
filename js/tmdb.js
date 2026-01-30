// OMDb wrapper (keeps the `TMDB` global for compatibility with the app)
const TMDB = (function(){
  // Replace with your OMDb API key
  const API_KEY = 'ed3d2c0';
  const BASE = 'https://www.omdbapi.com/';
  // OMDb returns full Poster URLs, so no base image URL is required
  const IMG = '';

  async function fetchEndpoint(params={}){
    const url = new URL(BASE);
    url.searchParams.set('apikey', API_KEY);
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    const res = await fetch(url);
    if (!res.ok) throw new Error('OMDb network error');
    const data = await res.json();
    return data;
  }

  async function search(query, page=1){
    if (!query) return { results: [] };
    const data = await fetchEndpoint({s: query, page});
    if (!data || data.Response === 'False' || !data.Search) return { results: [] };
    const results = data.Search.map(item=>({
      id: item.imdbID,
      poster_path: item.Poster && item.Poster !== 'N/A' ? item.Poster : '',
      title: item.Title,
      name: item.Title,
      media_type: item.Type === 'movie' ? 'movie' : 'tv',
      release_date: item.Year
    }));
    return { results };
  }

  async function getById(imdbID){
    if (!imdbID) return null;
    const data = await fetchEndpoint({i: imdbID, plot: 'short'});
    if (!data || data.Response === 'False') return null;
    return {
      id: data.imdbID,
      poster_path: data.Poster && data.Poster !== 'N/A' ? data.Poster : '',
      title: data.Title,
      name: data.Title,
      overview: data.Plot,
      release_date: data.Year,
      genres: data.Genre ? data.Genre.split(',').map(s=>s.trim()) : [],
      runtime: data.Runtime,
      media_type: data.Type === 'movie' ? 'movie' : 'tv'
    };
  }

  // Fetch a specific TV episode using Series imdbID + Season + Episode
  async function getEpisode(imdbSeriesID, season, episode){
    if (!imdbSeriesID || !season || !episode) return null;
    const data = await fetchEndpoint({i: imdbSeriesID, Season: season, Episode: episode, plot: 'short'});
    if (!data || data.Response === 'False') return null;
    return {
      id: data.imdbID || `${imdbSeriesID}-S${season}E${episode}`,
      series_id: imdbSeriesID,
      season: String(season),
      episode: String(episode),
      title: data.Title,
      overview: data.Plot,
      release_date: data.Year,
      runtime: data.Runtime,
      poster_path: data.Poster && data.Poster !== 'N/A' ? data.Poster : ''
    };
  }

  // Provide TMDB-like endpoints by performing broad OMDb searches.
  // These are best-effort: OMDb doesn't have 'now playing' or 'popular' feeds.
  function moviesNowPlaying(){ return search('the',1); }
  function moviesPopular(){ return search('a',1); }
  function moviesTopRated(){ return search('best',1); }

  function tvAiringToday(){ return search('the',1).then(r=>{ r.results = r.results.filter(x=>x.media_type==='tv'); return r; }); }
  function tvPopular(){ return search('series',1).then(r=>{ r.results = r.results.filter(x=>x.media_type==='tv'); return r; }); }
  function tvTopRated(){ return search('best',1).then(r=>{ r.results = r.results.filter(x=>x.media_type==='tv'); return r; }); }

  return {
    IMG, search, getById,
    moviesNowPlaying, moviesPopular, moviesTopRated,
    tvAiringToday, tvPopular, tvTopRated
  };
})();
