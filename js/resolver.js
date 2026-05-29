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
    if (!results.length) throw new Error('Movie not found on Showbox');
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

  async function getBestFile(shareKey) {
    var res = await fetch(api() + '/api/febbox/files?shareKey=' + shareKey + '&parent_id=0', { headers: hdrs() });
    if (!res.ok) throw new Error('Files failed (HTTP ' + res.status + ')');
    var files = await res.json();
    if (!Array.isArray(files) || !files.length) throw new Error('No files found');
    return files.reduce(function(a, b) {
      return (parseFloat(b.file_size) || 0) > (parseFloat(a.file_size) || 0) ? b : a;
    });
  }

  async function getLinks(shareKey, fid) {
    var res = await fetch(api() + '/api/febbox/links?shareKey=' + shareKey + '&fid=' + fid, { headers: hdrs() });
    if (!res.ok) throw new Error('Links failed (HTTP ' + res.status + ')');
    var links = await res.json();
    if (links && links.error) throw new Error(links.error);
    if (!Array.isArray(links) || !links.length) throw new Error('No links returned');
    return links;
  }

  async function resolve(opts) {
    var title = opts.title;
    var year  = opts.year  || '';
    var type  = opts.type  || 'movie';
    var isTV  = type === 'tv';
    var match = await searchTitle(title, year, isTV ? 'tv' : 'movie');
    var shareKey = await getFebboxId(match.mid || match.id, isTV ? '2' : '1');
    var bestFile = await getBestFile(shareKey);
    return await getLinks(shareKey, bestFile.fid);
  }

  return {
    resolve: resolve,
    setCookie: function(v) { _cookie = v; }
  };
})();
