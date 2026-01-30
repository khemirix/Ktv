// TMDB wrapper - simple helpers
const TMDB = (function(){
  // Replace with your TMDB API key
  const API_KEY = 'YOUR_TMDB_API_KEY';
  const BASE = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/w500';

  async function fetchEndpoint(path, params={}){
    const url = new URL(BASE + path);
    url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('language','en-US');
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    const res = await fetch(url);
    if (!res.ok) throw new Error('TMDB error');
    return res.json();
  }

  async function search(query){
    if(!query) return {results:[]};
    return fetchEndpoint('/search/multi',{query, page:1, include_adult:false});
  }

  // Movie endpoints
  function moviesNowPlaying(){ return fetchEndpoint('/movie/now_playing',{page:1}); }
  function moviesPopular(){ return fetchEndpoint('/movie/popular',{page:1}); }
  function moviesTopRated(){ return fetchEndpoint('/movie/top_rated',{page:1}); }

  // TV endpoints
  function tvAiringToday(){ return fetchEndpoint('/tv/airing_today',{page:1}); }
  function tvPopular(){ return fetchEndpoint('/tv/popular',{page:1}); }
  function tvTopRated(){ return fetchEndpoint('/tv/top_rated',{page:1}); }

  return {
    IMG, search,
    moviesNowPlaying, moviesPopular, moviesTopRated,
    tvAiringToday, tvPopular, tvTopRated
  };
})();
