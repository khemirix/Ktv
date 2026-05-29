var Resolver = (function () {
  var API_BASE = 'https://showbox-api-1.onrender.com';
  var _cookie = '';

  function api() { return API_BASE.replace(/\/$/, ''); }
  function hdrs() { return _cookie ? { 'x-auth-cookie': _cookie } : {}; }

  async function searchTitle(title, year, type) {
    var res = await fetch(api() + '/api/search?type=' + type + '&title=' + encodeURIComponent(title));
    if (!res.ok) throw new Error('Search failed (HTTP ' + res.status + ')');
    var data = await res.json();
    var results = (data && data.list) ? data.list : (Array.isArray(data) ? data : []);
    if (!results.length) throw new Error('Not found on Showbox');
    var match = results[0];
    if (year) {
      var byYear = results.find(function(r) { return String(r.year) === String(year); });
      if (byYear) match = byYear;
    }
    return match;
  }

  async function getFebboxId(showboxId, typeNum) {
    var res = await fetch(api() + '/api/febbox/id?id=' + showboxId + '&type=' + typeNum);
    if (!res.ok) throw new Error('Febbox ID failed (HTTP ' + res.status + ')');
    var data = await res.json();
    if (!data.febBoxId) throw new Error('Could not get Febbox share key');
    return data.febBoxId;
  }

  // Get all files for a shareKey (flat list under parent_id=0)
  async function getAllFiles(shareKey) {
    var res = await fetch(api() + '/api/febbox/files?shareKey=' + shareKey + '&parent_id=0', { headers: hdrs() });
    if (!res.ok) throw new Error('Files failed (HTTP ' + res.status + ')');
    var files = await res.json();
    if (!Array.isArray(files) || !files.length) throw new Error('No files found');
    return files;
  }

  // For TV: folders at root are seasons; we need to drill into the right season folder
  async function getFilesInFolder(shareKey, parentId) {
    var res = await fetch(api() + '/api/febbox/files?shareKey=' + shareKey + '&parent_id=' + parentId, { headers: hdrs() });
    if (!res.ok) throw new Error('Folder files failed (HTTP ' + res.status + ')');
    var files = await res.json();
    return Array.isArray(files) ? files : [];
  }

  async function getLinks(shareKey, fid) {
    var res = await fetch(api() + '/api/febbox/links?shareKey=' + shareKey + '&fid=' + fid, { headers: hdrs() });
    if (!res.ok) throw new Error('Links failed (HTTP ' + res.status + ')');
    var links = await res.json();
    if (links && links.error) throw new Error(links.error);
    if (!Array.isArray(links) || !links.length) throw new Error('No links returned');
    return links;
  }

  // Pick best (largest) file from a list
  function bestFile(files) {
    return files.reduce(function(a, b) {
      return (parseFloat(b.file_size) || 0) > (parseFloat(a.file_size) || 0) ? b : a;
    });
  }

  // ── Public: resolve a movie ──────────────────────────────────────
  async function resolveMovie(opts) {
    var title = opts.title, year = opts.year || '';
    var match = await searchTitle(title, year, 'movie');
    var shareKey = await getFebboxId(match.mid || match.id, '1');
    var files = await getAllFiles(shareKey);
    // Filter to video files only
    var videos = files.filter(function(f) { return f.fid && !f.is_dir; });
    if (!videos.length) throw new Error('No video files found');
    return await getLinks(shareKey, bestFile(videos).fid);
  }

  // ── Public: resolve a TV episode ────────────────────────────────
  // season and episode are numbers (1-based)
  async function resolveEpisode(opts) {
    var title   = opts.title;
    var year    = opts.year    || '';
    var season  = opts.season  || 1;
    var episode = opts.episode || 1;

    var match    = await searchTitle(title, year, 'tv');
    var shareKey = await getFebboxId(match.mid || match.id, '2');

    // Root level: season folders
    var rootFiles = await getAllFiles(shareKey);

    // Find the season folder — name usually contains the season number
    var seasonFolders = rootFiles.filter(function(f) { return f.is_dir || f.fid === undefined || f.file_name; });
    // Try matching folder name to season number
    var padded = String(season).padStart(2, '0');
    var seasonFolder = seasonFolders.find(function(f) {
      var n = (f.file_name || '').toLowerCase();
      return n.includes('season ' + season) ||
             n.includes('season' + season) ||
             n.includes('s' + padded) ||
             n === String(season);
    });

    var episodeFiles;
    if (seasonFolder && seasonFolder.fid) {
      // Drill into season folder
      episodeFiles = await getFilesInFolder(shareKey, seasonFolder.fid);
    } else {
      // Flat structure — all episodes at root
      episodeFiles = rootFiles;
    }

    // Filter to video files only
    var videos = episodeFiles.filter(function(f) { return !f.is_dir; });
    if (!videos.length) throw new Error('No episode files found');

    // Find the right episode file
    var epPadded = String(episode).padStart(2, '0');
    var epFile = videos.find(function(f) {
      var n = (f.file_name || '').toLowerCase();
      return n.includes('e' + epPadded) ||
             n.includes('episode ' + episode) ||
             n.includes('episode' + episode) ||
             n.includes('ep' + epPadded) ||
             n.includes(' ' + epPadded + ' ') ||
             n.includes('x' + epPadded);
    });

    // If no match by name, fall back to index
    if (!epFile) {
      epFile = videos[episode - 1] || videos[0];
    }

    return await getLinks(shareKey, epFile.fid);
  }

  // Generic entry point
  async function resolve(opts) {
    if (opts.type === 'tv') {
      return await resolveEpisode(opts);
    }
    return await resolveMovie(opts);
  }

  return {
    resolve: resolve,
    resolveMovie: resolveMovie,
    resolveEpisode: resolveEpisode,
    setCookie: function(v) { _cookie = v; }
  };
})();
