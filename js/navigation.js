/* navigation.js
   Handles TV remote (keyboard) navigation and focus state.
   Keeps rowIndex/colIndex and activeTab state for Netflix-like UX.
*/
const NAV = (function(){
  const state = {
    activeTab: 'movies', // 'movies' or 'tv' or 'search'
    rowIndex: 0,
    colIndex: 0,
    rows: [] // filled with DOM references
  };

  function setRows(rows){ state.rows = rows; state.rowIndex = 0; state.colIndex = 0; }

  function focusTabByName(name){
    state.activeTab = name;
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
    // reset focus to first row
    state.rowIndex = 0; state.colIndex = 0; render();
  }

  function render(){
    // Clear previous focus
    document.querySelectorAll('.card').forEach(c=>c.classList.remove('focused'));
    // highlight current
    const row = state.rows[state.rowIndex];
    if (!row) return;
    const cards = Array.from(row.querySelectorAll('.card'));
    cards.forEach(c=>c.classList.remove('dim'));
    const current = cards[state.colIndex] || cards[0];
    if (current) current.classList.add('focused');
    // dim other cards slightly
    cards.filter(c=>c!==current).forEach(c=>c.classList.add('dim'));
    // ensure visible by scrolling row container
    if (current) current.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
    // ensure the row is scrolled into view vertically
    row.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function onKey(e){
    const key = e.key;
    // If focus is on search input, let normal typing happen
    if (document.activeElement && document.activeElement.id === 'searchInput'){
      if (key === 'ArrowDown') { document.getElementById('searchInput').blur(); e.preventDefault(); }
      return;
    }
    if (key === 'ArrowLeft'){
      if (state.colIndex>0) state.colIndex--;
      else {
        // move focus to left tab if at start of first row
        const tabEls = Array.from(document.querySelectorAll('.tab'));
        const activeIdx = tabEls.findIndex(t=>t.classList.contains('active'));
        if (activeIdx>0) tabEls[activeIdx-1].focus();
      }
      render(); e.preventDefault();
    } else if (key === 'ArrowRight'){
      const row = state.rows[state.rowIndex];
      const max = row ? row.querySelectorAll('.card').length - 1 : 0;
      if (state.colIndex < max) state.colIndex++; else state.colIndex = max;
      render(); e.preventDefault();
    } else if (key === 'ArrowUp'){
      if (state.rowIndex>0) state.rowIndex--; else {
        // focus back to tabs
        const activeTabEl = document.querySelector(`.tab[data-tab="${state.activeTab}"]`);
        if (activeTabEl) { activeTabEl.focus(); }
      }
      render(); e.preventDefault();
    } else if (key === 'ArrowDown'){
      if (state.rowIndex < state.rows.length - 1) state.rowIndex++;
      render(); e.preventDefault();
    } else if (key === 'Enter'){
      // activate current card
      const row = state.rows[state.rowIndex];
      if (!row) return;
      const current = row.querySelectorAll('.card')[state.colIndex] || row.querySelector('.card');
      if (current) {
        const id = current.dataset.id;
        // navigate to player using slash-separated params: ?type/id
        location.href = `player.html?${current.dataset.type}/${id}`;
      }
    } else if (key === 'Backspace' || key === 'Escape'){
      // go back
      if (location.pathname.endsWith('/player.html')) history.back();
      else { /* could add overlays, for now nothing */ }
    }
  }

  // Expose
  window.addEventListener('keydown', onKey);
  return {state, setRows, focusTabByName, render};
})();
