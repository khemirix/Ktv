var Resolver = (function () {
  var API_BASE = 'https://showbox-api-1.onrender.com';
  var TIMEOUT_MS = 20000;

  function api() { return API_BASE.replace(/\/$/, ''); }

  // ── Fetch with timeout and useful errors ─────────────────────────
  async function fetchJSON(path) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS)
      : null;
    var res;
    try {
      res = await fetch(api() + path, {
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Request timed out — the API may be waking up, please try again');
      }
      throw new Error('Network error: ' + ((err && err.message) || err));
    } finally {
      if (timer) clearTimeout(timer);
    }

    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep null */ }

    if (!res.ok) {
      var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function normalize(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  // ── Search: prefer exact title, then year, then first result ────
  async function searchTitle(title, year, type) {
    var data = await fetchJSON(
      '/api/search?type=' + encodeURIComponent(type) +
      '&title=' + encodeURIComponent(title)
    );
    var results = (data && data.list)
      ? data.list
      : (Array.isArray(data) ? data : []);
    if (!results.length) throw new Error('Not found on Showbox');

    var target = normalize(title);
    var ranked = results.map(function (r, i) {
      var name = normalize(r.title || r.name || '');
      var score = 0;
      if (name === target) score += 100;
      else if (name.indexOf(target) === 0) score += 60;
      else if (name.indexOf(target) !== -1) score += 30;
      if (year && String(r.year) === String(year)) score += 50;
      return { item: r, score: score, index: i };
    }).sort(function (a, b) {
      return (b.score - a.score) || (a.index - b.index);
    });

    return ranked[0].item;
  }

  async function getFebboxId(showboxId, typeNum) {
    if (!showboxId) throw new Error('Showbox ID missing');
    var data = await fetchJSON(
      '/api/febbox/id?id=' + encodeURIComponent(showboxId) +
      '&type=' + encodeURIComponent(typeNum)
    );
    if (!data || !data.febBoxId) throw new Error('This film is not available yet — please check another day');
    return data.febBoxId;
  }

  async function getAllFiles(shareKey) {
    var files = await fetchJSON(
      '/api/febbox/files?shareKey=' + encodeURIComponent(shareKey) + '&parent_id=0'
    );
    if (!Array.isArray(files) || !files.length) throw new Error('No files found');
    return files;
  }

  async function getFilesInFolder(shareKey, parentId) {
    var files = await fetchJSON(
      '/api/febbox/files?shareKey=' + encodeURIComponent(shareKey) +
      '&parent_id=' + encodeURIComponent(parentId)
    );
    return Array.isArray(files) ? files : [];
  }

  async function getLinks(shareKey, fid) {
    var data = await fetchJSON(
      '/api/febbox/links?shareKey=' + encodeURIComponent(shareKey) +
      '&fid=' + encodeURIComponent(fid)
    );
    var links = (data && data.links) ? data.links : data;
    if (links && links.error) throw new Error(links.error);
    if (!Array.isArray(links) || !links.length) {
      throw new Error(
        'No stream links are available for this file right now'
      );
    }

    var usable = links.map(function (l) {
      return {
        url: l.url,
        quality: l.quality || l.name || '',
        name: l.name || '',
        size: l.size || '',
        speed: l.speed || ''
      };
    }).filter(function (l) { return !!l.url; });

    if (!usable.length) throw new Error('No playable links returned');
    return usable;
  }

  // ── Size parsing: "3.61 GB" must beat "800 MB" ──────────────────
  function parseSize(value) {
    if (typeof value === 'number') return value;
    var m = /^\s*([\d.,]+)\s*([kmgtp]i?b?|[kmgtp]?)\s*$/i.exec(String(value || ''));
    if (!m) return 0;
    var amount = parseFloat(m[1].replace(/,/g, '')) || 0;
    var unit = (m[2] || '').toLowerCase();
    var powers = {
      b: 0, k: 1, kb: 1, kib: 1, m: 2, mb: 2, mib: 2,
      g: 3, gb: 3, gib: 3, t: 4, tb: 4, tib: 4,
      p: 5, pb: 5, pib: 5
    };
    return amount * Math.pow(1024, powers[unit] || 0);
  }

  function bestFile(files) {
    return files.reduce(function (best, cur) {
      var d = parseSize(cur.file_size) - parseSize(best.file_size);
      if (d > 0) return cur;
      if (d === 0) return naturalCompare(cur.file_name, best.file_name) > 0 ? cur : best;
      return best;
    }, files[0]);
  }

  function isVideo(f) {
    return !!(f && f.fid !== undefined && !f.is_dir);
  }

  // ── Season / episode name parsing ───────────────────────────────
  function seasonFromName(name) {
    var n = String(name || '').toLowerCase();
    var m = /(?:season|s)\s*[-_. ]?\s*0*(\d{1,3})\b/.exec(n);
    if (m) return parseInt(m[1], 10);
    m = /(?:^|[\s_-])(0?\d{1,2})(?:$|[\s_-])/.exec(n);
    return m ? parseInt(m[1], 10) : null;
  }

  function episodeInfo(name) {
    var n = String(name || '').toLowerCase();
    var m = /\bs\s*0*(\d{1,3})\s*[-_. ]?\s*e\s*0*(\d{1,4})\b/.exec(n);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    m = /\b0*(\d{1,3})\s*[x×]\s*0*(\d{1,4})\b/.exec(n);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    var episode = null;
    m = /\b(?:episode|ep|e)\s*[-_. ]?\s*0*(\d{1,4})\b/.exec(n);
    if (m) episode = parseInt(m[1], 10);

    if (episode === null) {
      var parts = n.split(/[^0-9]+/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && parts[i].length <= 2) {
          var value = parseInt(parts[i], 10);
          if (value >= 1 && value <= 99) { episode = value; break; }
        }
      }
    }
    return { season: null, episode: episode };
  }

  // ── Public: resolve a movie ──────────────────────────────────────
  async function resolveMovie(opts) {
    var match = await searchTitle(opts.title, opts.year || '', 'movie');
    var shareKey = await getFebboxId(match.mid || match.id, '1');
    var files = await getAllFiles(shareKey);

    var videos = files.filter(isVideo);
    if (!videos.length) throw new Error('No video files found in this Febbox share');
    return await getLinks(shareKey, bestFile(videos).fid);
  }

  // ── Public: resolve a TV episode ────────────────────────────────
  async function resolveEpisode(opts) {
    var title = opts.title;
    var year = opts.year || '';
    var season = Number(opts.season) || 1;
    var episode = Number(opts.episode) || 1;

    var match = await searchTitle(title, year, 'tv');
    var shareKey = await getFebboxId(match.mid || match.id, '2');
    var rootFiles = await getAllFiles(shareKey);

    var seasonFolders = rootFiles.filter(function (f) {
      return f.is_dir || f.fid === undefined;
    }).filter(function (f) {
      return seasonFromName(f.file_name) === season;
    });

    var episodeFiles = seasonFolders.length
      ? await getFilesInFolder(shareKey, seasonFolders[0].fid)
      : rootFiles;

    var videos = episodeFiles.filter(isVideo);
    if (!videos.length) throw new Error('No episode files found for season ' + season);
    videos.sort(function (a, b) { return naturalCompare(a.file_name, b.file_name); });

    // Prefer files that explicitly belong to the requested season.
    var seasonVideos = videos.filter(function (f) {
      var info = episodeInfo(f.file_name);
      return info.season !== null && info.season === season;
    });
    var pool = seasonVideos.length ? seasonVideos : videos;

    var epFile = pool.filter(function (f) {
      return episodeInfo(f.file_name).episode === episode;
    })[0];

    if (!epFile) epFile = pool[episode - 1] || pool[0];
    return await getLinks(shareKey, epFile.fid);
  }

  async function resolve(opts) {
    if (opts.type === 'tv') return await resolveEpisode(opts);
    return await resolveMovie(opts);
  }

  return {
    resolve: resolve,
    resolveMovie: resolveMovie,
    resolveEpisode: resolveEpisode,
    getApiBase: function () { return api(); },
    setApiBase: function (v) { API_BASE = v; }
  };
})();
