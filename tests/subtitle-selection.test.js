// Verifies the two-step subtitle flow: four fixed languages with counts,
// best-three choices, manual selection, and no automatic subtitle download.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'subtitles.js'), 'utf8');

function makeEl(tag, id) {
  const el = {
    tagName: tag,
    id: id || '',
    children: [],
    listeners: {},
    attributes: {},
    style: { setProperty() {} },
    hidden: false,
    textContent: '',
    get className() { return this.attributes.class || ''; },
    set className(value) { this.attributes.class = value; },
    set innerHTML(value) {
      this._innerHTML = String(value);
      if (value === '') this.children = [];
    },
    get innerHTML() { return this._innerHTML || ''; },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    }
  };
  return el;
}

function createContext(fetchImpl) {
  const elements = new Map();
  const storage = new Map();
  const documentStub = {
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: makeEl('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl('div', id));
      return elements.get(id);
    },
    createElement(tag) { return makeEl(tag); }
  };
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document: documentStub,
    window: {
      Resolver: { getApiBase: () => 'https://api.example' }
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    URLSearchParams,
    URL,
    AbortController,
    Date,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl
  };
  sandbox.Resolver = sandbox.window.Resolver;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'subtitles.js' });
  return { sandbox, documentStub, storage };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function subtitleResult(id, provider, lang, release) {
  return {
    id: provider + ':' + id,
    provider: provider,
    providerLabel: provider,
    name: release,
    release: release,
    lang: lang,
    format: 'srt',
    url: '/api/subtitles/file?id=' + id,
    score: 50
  };
}

const RESULTS = [
  subtitleResult('ar-3', 'mysubs', 'ar', 'Film.AR.three'),
  subtitleResult('fr-1', 'subdl', 'fr', 'Film.FR.one'),
  subtitleResult('fr-2', 'wyzie', 'fr', 'Film.FR.two'),
  subtitleResult('fr-3', 'opensubtitles', 'fr', 'Film.FR.three'),
  subtitleResult('fr-4', 'subdl', 'fr', 'Film.FR.four'),
  subtitleResult('en-1', 'subtitles-website', 'en', 'Film.EN.one'),
  subtitleResult('pl-1', 'opensubtitles', 'pl', 'Film.PL.one'),
  subtitleResult('de-1', 'subdl', 'de', 'Film.DE.one')
];

function jsonFetch(results) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({
      subtitle: results[0] || null,
      results: results,
      languages: [],
      errors: []
    }) };
  };
  fn.calls = calls;
  return fn;
}

test('provider list contains the two existing and three new providers', () => {
  const ctx = createContext(jsonFetch(RESULTS));
  assert.deepEqual(Array.from(ctx.sandbox.Subtitles.providers, (provider) => provider.id), [
    'auto', 'mysubs', 'subtitles-website', 'subdl', 'wyzie', 'opensubtitles'
  ]);
  assert.deepEqual(Array.from(ctx.sandbox.Subtitles.languages, (lang) => lang.code), [
    'ar', 'fr', 'en', 'pl'
  ]);
});

test('search sends title/provider metadata and keeps only the four languages', async () => {
  const fetchImpl = jsonFetch(RESULTS);
  const ctx = createContext(fetchImpl);
  const data = await ctx.sandbox.Subtitles.search({
    imdbId: 'tt1234567', type: 'tv', title: 'Film', season: 2, episode: 5
  }, 'auto');

  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.pathname, '/api/subtitles/search');
  assert.equal(url.searchParams.get('imdb'), 'tt1234567');
  assert.equal(url.searchParams.get('title'), 'Film');
  assert.equal(url.searchParams.get('season'), '2');
  assert.equal(url.searchParams.get('episode'), '5');
  assert.equal(url.searchParams.get('provider'), 'auto');
  assert.deepEqual(Array.from(data.languages, (lang) => lang.code), ['ar', 'fr', 'en', 'pl']);
  assert.equal(data.languages.find((lang) => lang.code === 'fr').count, 4);
  assert.ok(!data.results.some((result) => result.lang === 'de'));
});

test('attach shows languages first, best three second, and never auto-downloads', async () => {
  const ctx = createContext(jsonFetch(RESULTS));
  const video = makeEl('video');
  video.textTracks = [];
  const reports = [];
  const manager = ctx.sandbox.Subtitles.attach(video, {
    imdbId: 'tt1234567', type: 'movie', title: 'Film'
  }, (status, name, info) => reports.push({ status, name, info }), { provider: 'auto', language: 'ar' });
  await flush();

  assert.equal(reports[reports.length - 1].status, 'none');
  assert.equal(video.children.length, 0, 'no track is attached before the user chooses');
  const languages = reports[reports.length - 1].info.languages;
  assert.deepEqual(Array.from(languages, (lang) => lang.code), ['ar', 'fr', 'en', 'pl']);
  assert.equal(languages.find((lang) => lang.code === 'fr').count, 4);
  assert.equal(reports[reports.length - 1].info.choices.length, 1);

  assert.equal(manager.setLanguage('fr'), true);
  const afterLanguage = reports[reports.length - 1];
  assert.equal(afterLanguage.status, 'none');
  assert.equal(video.children.length, 0);
  assert.deepEqual(Array.from(afterLanguage.info.choices, (item) => item.id), [
    'subdl:fr-1', 'wyzie:fr-2', 'opensubtitles:fr-3'
  ]);
  assert.ok(afterLanguage.info.choices.every((item) => item.providerLabel));
  assert.ok(afterLanguage.info.choices.every((item) => item.release));

  assert.equal(manager.selectSubtitle('wyzie:fr-2'), true);
  const afterChoice = reports[reports.length - 1];
  assert.equal(afterChoice.status, 'on');
  assert.equal(afterChoice.name, 'Film.FR.two');
  assert.equal(video.children.length, 1);
  assert.equal(video.children[0].tagName, 'track');
  assert.equal(video.children[0].srclang, 'fr');
  assert.equal(video.children[0].src, 'https://api.example/api/subtitles/file?id=fr-2');
  assert.equal(manager.getState().selectedId, 'wyzie:fr-2');

  assert.equal(manager.setLanguage('pl'), true);
  assert.equal(video.children.length, 0, 'changing language detaches the old track');
  assert.equal(reports[reports.length - 1].status, 'none');
  assert.equal(reports[reports.length - 1].info.choices.length, 1);
  manager.destroy();
});

test('a failed search still exposes exactly four languages with zero counts', async () => {
  const ctx = createContext(async () => { throw new Error('network down'); });
  const video = makeEl('video');
  video.textTracks = [];
  let last = null;
  const manager = ctx.sandbox.Subtitles.attach(video, {
    imdbId: 'tt1234567', type: 'movie'
  }, (status, name, info) => { last = { status, info }; }, {});
  await flush();

  assert.deepEqual(Array.from(last.info.languages, (lang) => lang.code), ['ar', 'fr', 'en', 'pl']);
  assert.ok(last.info.languages.every((lang) => lang.count === 0));
  assert.equal(last.status, 'none');
  assert.equal(video.children.length, 0);
  manager.destroy();
});

test('explicit provider selection sends only that provider', async () => {
  const fetchImpl = jsonFetch([subtitleResult('pl-9', 'subdl', 'pl', 'Explicit.PL')]);
  const ctx = createContext(fetchImpl);
  await ctx.sandbox.Subtitles.search({ imdbId: 'tt7654321', type: 'movie' }, 'subdl');
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.get('provider'), 'subdl');
});
