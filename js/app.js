/* app.js
   Bootstraps the UI, fetches rows from TMDB, renders cards, and wires search.
*/
(async function(){
  const main = document.getElementById('main');
  const tabs = document.querySelectorAll('.tab');
  const searchInput = document.getElementById('searchInput');

  function makeRow(title, items, type){
    const row = document.createElement('section');
    row.className = 'row';
    const h = document.createElement('div'); h.className='row-title'; h.textContent = title;
    const list = document.createElement('div'); list.className='row-list';
    items.forEach(it=>{
      const c = document.createElement('div'); c.className='card';
      c.dataset.id = it.id; c.dataset.type = type;
      const img = document.createElement('img');
      img.src = it.poster_path ? (TMDB.IMG + it.poster_path) : '';
      img.alt = it.title || it.name || 'poster';
      c.appendChild(img);
      // Make cards clickable with mouse/tap using the new slash-style player params
      c.addEventListener('click', ()=>{ location.href = `player.html?${type}/${it.id}`; });
      list.appendChild(c);
    });
    row.appendChild(h); row.appendChild(list);
    return row;
  }

  async function loadMovies(){
    const [now, popular, top] = await Promise.all([TMDB.moviesNowPlaying(), TMDB.moviesPopular(), TMDB.moviesTopRated()]);
    // sort each by release_date desc if available
    const sortByDate = arr=>arr.slice().sort((a,b)=>((b.release_date||b.first_air_date||'') > (a.release_date||a.first_air_date||'')?1:-1));
    const rows = [];
    rows.push(makeRow('Now Playing', sortByDate(now.results), 'movie'));
    rows.push(makeRow('Popular', sortByDate(popular.results), 'movie'));
    rows.push(makeRow('Top Rated', sortByDate(top.results), 'movie'));
    return rows;
  }

  async function loadTV(){
    const [airing, popular, top] = await Promise.all([TMDB.tvAiringToday(), TMDB.tvPopular(), TMDB.tvTopRated()]);
    const sortByDate = arr=>arr.slice().sort((a,b)=>( (b.first_air_date||'') > (a.first_air_date||'')?1:-1));
    const rows = [];
    rows.push(makeRow('Airing Today', sortByDate(airing.results), 'tv'));
    rows.push(makeRow('Popular', sortByDate(popular.results), 'tv'));
    rows.push(makeRow('Top Rated', sortByDate(top.results), 'tv'));
    return rows;
  }

  async function renderMainFor(tab){
    main.innerHTML = '';
    let rows;
    if (tab === 'movies') rows = await loadMovies();
    else if (tab === 'tv') rows = await loadTV();
    else rows = [];
    rows.forEach(r=>main.appendChild(r));
    // wire rows to NAV module
    const rowEls = Array.from(document.querySelectorAll('.row-list'));
    NAV.setRows(rowEls);
    NAV.focusTabByName(tab);
    NAV.render();
  }

  // tab clicks
  tabs.forEach(t=>t.addEventListener('click', ()=>{ renderMainFor(t.dataset.tab); }));

  // search handling: replaces main content with a single row of results
  let searchTimer = null;
  searchInput.addEventListener('keydown', async (e)=>{
    if (e.key === 'Enter'){
      const q = searchInput.value.trim();
      if (!q) return;
      const res = await TMDB.search(q);
      main.innerHTML = '';
      const items = res.results.filter(r=>r.media_type !== 'person');
      const row = makeRow(`Search: ${q}`, items, 'multi');
      main.appendChild(row);
      NAV.setRows([row.querySelector('.row-list')]);
      NAV.focusTabByName('search');
      NAV.render();
    }
  });

  // wire tab keyboard focus to trigger load
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('focus', ()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const name = t.dataset.tab;
      renderMainFor(name);
    });
  });

  // initial load
  renderMainFor('movies');

})();
