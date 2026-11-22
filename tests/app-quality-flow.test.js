'use strict';

// Integration-style checks for the real Cre playback flow: selected quality,
// badge/active state, manual override, reset on a new title, and persisted
// quality preference.
// Run with: node tests/app-quality-flow.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const MEDIA_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'media-player.js'), 'utf8');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeEl(id, tagName) {
  const el = {
    id: id || '',
    tagName: (tagName || 'div').toUpperCase(),
    hidden: false,
    disabled: false,
    textContent: '',
    title: '',
    tabIndex: 0,
    style: {},
    dataset: {},
    children: [],
    listeners: {},
    attrs: {},
    parentElement: null,
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    removeEventListener() {},
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    querySelectorAll(selector) {
      const match = /^\.([\w-]+)$/.exec(selector);
      if (!match) return [];
      return this.children.filter((child) => child.classList.contains(match[1]));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
    contains() { return false; },
    focus() {}
  };

  const classSet = new Set();
  el.classList = {
    add(...names) { names.forEach((name) => classSet.add(name)); },
    remove(...names) { names.forEach((name) => classSet.delete(name)); },
    contains(name) { return classSet.has(name); },
    toggle(name, force) {
      if (force === undefined) force = !classSet.has(name);
      if (force) classSet.add(name);
      else classSet.delete(name);
      return force;
    }
  };

  Object.defineProperty(el, 'className', {
    get() { return Array.from(classSet).join(' '); },
    set(value) {
      classSet.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classSet.add(name));
    }
  });

  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML || ''; },
    set(value) {
      el._innerHTML = String(value);
      if (value === '') el.children = [];
    }
  });

  return el;
}

function createContext(options) {
  const elements = new Map();
  const storage = new Map();
  const loads = [];
  const state = { created: 0, destroyed: 0 };
  const resolverQueue = [];

  const documentStub = {
    head: makeEl('head'),
    body: makeEl('body'),
    fullscreenElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    createElement(tag) { return makeEl('', tag); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    exitFullscreen() { return Promise.resolve(); }
  };

  const windowStub = {
    location: { search: '', pathname: '/index.html', href: 'https://site.example/index.html' },
    addEventListener() {}
  };
  windowStub.parent = windowStub;

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document: documentStub,
    window: windowStub,
    navigator: { userAgent: 'node', connection: { effectiveType: '2g' } },
    history: { replaceState() {} },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    URLSearchParams,
    URL,
    AbortController,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    setImmediate,
    fetch: () => Promise.reject(new Error('probe should not run in this test'))
  };

  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SOURCE, sandbox, { filename: 'media-player.js' });
  const real = sandbox.MediaPlayer;

  sandbox.MediaPlayer = {
    isHls: real.isHls,
    networkTier: real.networkTier,
    estimateNetworkTier: real.estimateNetworkTier,
    chooseDefault: real.chooseDefault,
    fallbackFor: real.fallbackFor,
    qualityRank: real.qualityRank,
    supportsNativeHls: real.supportsNativeHls,
    hlsJsAvailable: real.hlsJsAvailable,
    create(video, handlers) {
      state.created += 1;
      const playerNumber = state.created;
      const controller = {
        load(url, opts) {
          loads.push({ player: playerNumber, url, opts, handlers });
        },
        destroy() { state.destroyed += 1; },
        resync() {},
        kind() { return 'stub'; }
      };
      controller.emitPlaying = (url) => {
        if (handlers.onPlaying) handlers.onPlaying({ url, kind: 'stub' });
      };
      state.lastController = controller;
      return controller;
    }
  };

  const item = {
    id: 1,
    title: 'Test Movie',
    release_date: '2020-01-01',
    poster_path: '',
    overview: 'Test overview'
  };
  const empty = () => Promise.resolve({ results: [] });

  sandbox.TMDB = {
    IMG: 'https://image.example/w500',
    IMG_HD: 'https://image.example/original',
    trendingMovies: () => Promise.resolve({ results: [item] }),
    moviesPopular: empty,
    moviesRecentlyAdded: empty,
    moviesTopRated: empty,
    discoverMovies: empty,
    moviesRecommended: empty,
    trendingTv: empty,
    tvPopular: empty,
    tvRecentlyAdded: empty,
    tvTopRated: empty,
    discoverTv: empty,
    tvAnime: empty,
    tvRecommended: empty,
    search: empty,
    getById: () => Promise.resolve(null),
    getImdbId: () => Promise.resolve(null),
    getSeason: () => Promise.resolve({ episodes: [] })
  };

  sandbox.Resolver = {
    getApiBase: () => 'https://api.example',
    resolveMovie: () => Promise.resolve(resolverQueue.shift() || options.fallbackLinks),
    resolveEpisode: () => Promise.resolve(resolverQueue.shift() || options.fallbackLinks)
  };

  sandbox.Subtitles = {
    attach() { return { setEnabled() {}, resync() {}, destroy() {} }; }
  };

  return { sandbox, documentStub, loads, state, resolverQueue, storage };
}

const LINKS_A = [
  { quality: '1080p', url: 'https://hls.example/a-1080.m3u8' },
  { quality: 'ORG', url: 'https://cdn.example/a-original.mp4' },
  { quality: '720p', url: 'https://hls.example/a-720.m3u8' },
  { quality: '360p', url: 'https://hls.example/a-360.m3u8' }
];

const LINKS_B = [
  { quality: '720p', url: 'https://hls.example/b-720.m3u8' },
  { quality: '360p', url: 'https://hls.example/b-360.m3u8' },
  { quality: 'ORG', url: 'https://cdn.example/b-original.mp4' }
];

const LINKS_C = [
  { quality: '1080p', url: 'https://hls.example/c-1080.m3u8' },
  { quality: '720p', url: 'https://hls.example/c-720.m3u8' },
  { quality: '360p', url: 'https://hls.example/c-360.m3u8' }
];

const LINKS_D = [
  { quality: '720p', url: 'https://hls.example/d-720.m3u8' },
  { quality: '360p', url: 'https://hls.example/d-360.m3u8' }
];

function activeIndex(qualityList) {
  return qualityList.children.findIndex((button) => button.classList.contains('active'));
}

async function main() {
  const ctx = createContext({ fallbackLinks: LINKS_A });
  vm.runInContext(APP_SOURCE, ctx.sandbox, { filename: 'app.js' });
  await flush();
  await flush();

  const qualityList = ctx.documentStub.getElementById('qualityList');
  const badge = ctx.documentStub.getElementById('qualityBadge');

  // 1. Initial automatic selection ignores API order.
  ctx.sandbox.window.openPlayerModal(1, 'movie');
  await flush();
  await flush();

  assert.strictEqual(ctx.loads.length, 1, 'initial playback should load exactly once');
  assert.strictEqual(ctx.loads[0].url, LINKS_A[3].url);
  assert.strictEqual(ctx.loads[0].opts.fallbackUrl, LINKS_A[1].url);
  assert.strictEqual(qualityList.children.length, LINKS_A.length);
  assert.strictEqual(activeIndex(qualityList), -1, 'no quality is active before playback starts');
  assert.strictEqual(badge.textContent, 'Loading 360p…');
  assert.match(badge.title, /slow connection/);
  console.log('PASS initial automatic selection uses 360p and waits for playback');

  ctx.state.lastController.emitPlaying(LINKS_A[3].url);
  assert.strictEqual(activeIndex(qualityList), 3);
  assert.strictEqual(badge.textContent, '360p');
  console.log('PASS badge and active button update only after playback starts');

  // 2. Manual selection overrides automatic selection for this playback.
  qualityList.children[0].listeners.click[0]();
  await flush();

  assert.strictEqual(ctx.loads.length, 2, 'manual selection should cause exactly one extra load');
  assert.strictEqual(ctx.loads[1].url, LINKS_A[0].url);
  assert.strictEqual(activeIndex(qualityList), -1, 'manual quality is not active before it plays');
  assert.strictEqual(badge.textContent, 'Loading 1080p…');
  ctx.state.lastController.emitPlaying(LINKS_A[0].url);
  assert.strictEqual(activeIndex(qualityList), 0);
  assert.strictEqual(badge.textContent, '1080p');
  console.log('PASS manual selection overrides automatic choice without extra reload');

  // 3. Remember button persists an explicitly chosen quality.
  ctx.documentStub.getElementById('rememberQuality').listeners.click[0]();
  assert.strictEqual(ctx.storage.get('ktv_quality_pref'), '1080p');
  console.log('PASS remember-quality control stores an explicit preference');

  // 4. New movie recalculates the automatic default unless a preference matches.
  ctx.storage.delete('ktv_quality_pref');
  ctx.resolverQueue.push(LINKS_B);
  ctx.sandbox.window.openPlayerModal(1, 'movie');
  await flush();
  await flush();

  assert.strictEqual(ctx.loads.length, 3, 'new movie loads exactly once');
  assert.strictEqual(ctx.loads[2].url, LINKS_B[1].url);
  assert.strictEqual(ctx.loads[2].player, 2);
  assert.strictEqual(ctx.state.destroyed, 1);
  assert.strictEqual(activeIndex(ctx.documentStub.getElementById('qualityList')), -1);
  assert.strictEqual(ctx.documentStub.getElementById('qualityBadge').textContent, 'Loading 360p…');
  ctx.state.lastController.emitPlaying(LINKS_B[1].url);
  assert.strictEqual(activeIndex(ctx.documentStub.getElementById('qualityList')), 1);
  console.log('PASS new movie resets automatic selection and discards manual choice');

  // 5. A stored preference overrides the automatic low-network default.
  ctx.storage.set('ktv_quality_pref', '720p');
  ctx.resolverQueue.push(LINKS_C);
  ctx.sandbox.window.openPlayerModal(1, 'movie');
  await flush();
  await flush();

  assert.strictEqual(ctx.loads[3].url, LINKS_C[1].url);
  assert.match(ctx.documentStub.getElementById('qualityBadge').title, /Saved quality preference/);
  ctx.state.lastController.emitPlaying(LINKS_C[1].url);
  assert.strictEqual(activeIndex(ctx.documentStub.getElementById('qualityList')), 1);
  assert.strictEqual(ctx.documentStub.getElementById('qualityBadge').textContent, '720p');
  console.log('PASS stored quality preference overrides automatic selection');

  // 6. A new episode uses the same recalculated default path.
  ctx.storage.delete('ktv_quality_pref');
  ctx.resolverQueue.push(LINKS_D);
  ctx.sandbox.window.openPlayerModal(1, 'tv', {
    season: 1,
    episode: 1,
    details: { id: 1, seasons: [{ season_number: 1 }] }
  });
  await flush();
  await flush();
  await flush();

  assert.strictEqual(ctx.loads[4].url, LINKS_D[1].url);
  assert.strictEqual(ctx.loads[4].player, 4);
  ctx.state.lastController.emitPlaying(LINKS_D[1].url);
  assert.strictEqual(activeIndex(ctx.documentStub.getElementById('qualityList')), 1);
  console.log('PASS new episode recalculates automatic selection');

  console.log('app quality-flow tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
