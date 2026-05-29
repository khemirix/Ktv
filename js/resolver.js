/**
 * resolver.js
 * Resolves a TMDB movie/show title+year into direct stream URLs
 * via the Showbox → Febbox pipeline. No fallback.
 */
const Resolver = (function () {

  const API_BASE = 'https://showbox-api-1.onrender.com';
  let _cookie = '';

  function api() { return API_BASE.replace(/\/$/, ''); }
  function hdrs() { return _cookie ? { 'x-auth-cookie': _cookie } : {}; }

  async function searchTitle(title, year, type) {
    const res = await fetch(`${api()}/api/search?type=${type}&title=${encodeURIComponent(title)}`);
    if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
    const data = await res.json();
    const results = data?.list || data || [];
    if (!results.length) throw new Error('Movie not found');
    let match = results[0];
    if (year) {
      const byYear = results.find(r => String(r.year) === String(year));
      if (byYear) match = byYear;
    }
    return match;
  }

  async function getFebboxId(showboxId, typeNum) {
    const res = await fetch(`${api()}/api/febbox/id?id=${showboxId}&type=${typeNum}`);
    if (!res.ok) throw new Error(`Febbox ID failed (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.febBoxId) throw new Error('Could not get Febbox share key');
    return data.febBoxId;
  }

  async function getBestFile(shareKey) {
    const res = await fetch(`${api()}/api/febbox/files?shareKey=${shareKey}&parent_id=0`, { headers: hdrs() });
    if (!res.ok) throw new Error(`Files failed (HTTP ${res.status})`);
    const files = await res.json();
    if (!Array.isArray(files) || !files.length) throw new Error('No files found');
    return files.reduce((a, b) => (parseFloat(b.file_size) || 0) > (parseFloat(a.file_size) || 0) ? b : a);
  }

  async function getLinks(shareKey, fid) {
    const res = await fetch(`${api()}/api/febbox/links?shareKey=${shareKey}&fid=${fid}`, { headers: hdrs() });
    if (!res.ok) throw new Error(`Links failed (HTTP ${res.status})`);
    const links = await res.json();
    if (links.error) throw new Error(links.error);
    if (!Array.isArray(links) || !links.length) throw new Error('No links returned');
    return links;
  }

  // Returns array of { url, quality, name } or throws
  async function resolve({ title, year, type = 'movie' }) {
    const isTV = type === 'tv';
    const match = await searchTitle(title, year, isTV ? 'tv' : 'movie');
    const shareKey = await getFebboxId(match.mid || match.id, isTV ? '2' : '1');
    const bestFile = await getBestFile(shareKey);
    return await getLinks(shareKey, bestFile.fid);
  }

  return {
    resolve,
    setCookie(v) { _cookie = v; }
  };
})();
