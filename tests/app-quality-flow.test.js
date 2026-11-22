'use strict';

// Integration-style tests for initial quality selection, manual override,
// reset on a new title, and avoiding redundant playback restarts.
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
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
    contains() {
      return false;
    },
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

function createSandbox(options) {
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
    location: { search: '', pathname: '/index.html', href: 'http://localhost/index.html' },
    history: { replaceState() {} },
    addEventListener() {}
  };
  windowStub.parent = windowStub;

  const sandbox = {
    console,
    document: documentStub,
    window: windowStub,
    navigator: { userAgent: 'node', connection: { effectiveType: '2g', downlink: 0.8 } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value))
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setImmediate,
    fetch: () => { throw new Error('fetch should not be used in this test'); }
  };

  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SOURCE, sandbox, { filename: 'media-player.js' });
  const realMediaPlayer = sandbox.MediaPlayer;

  sandbox.MediaPlayer = {
    isHls: realMediaPlayer.isHls,
    networkTier: realMediaPlayer.networkTier,
    chooseDefault: realMediaPlayer.chooseDefault,
    fallbackFor: realMediaPlayer.fallbackFor,
    supportsNativeHls: realMediaPlayer.supportsNativeHls,
    hlsJsAvailable: realMediaPlayer.hlsJsAvailable,
    create() {
      state.created += 1;
      const playerNumber = state.created;
      return {
        load(url, opts) { loads.push({ player: playerNumber, url, opts }); },
        destroy() { state.destroyed += 1; }
      };
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
    resolveMovie() {
      return Promise.resolve(resolverQueue.shift() || options.fallbackLinks);
    },
    resolveEpisode() {
      return Promise.resolve(resolverQueue.shift() || options.fallbackLinks);
    }
  };

  sandbox.Subtitles = {
    attach() {
      return { setEnabled() {}, resync() {}, destroy() {} };
    }
  };

  return { sandbox, documentStub, elements, loads, state, resolverQueue };
}

const LINKS_A = [
  { quality: 'ORG', url: 'https://cdn.example/a-original.mp4' },
  { quality: '1080p', url: 'https://hls.example/a-1080.m3u8' },
  { quality: '720p', url: 'https://hls.example/a-720.m3u8' },
  { quality: '360p', url: 'https://hls.example/a-360.m3u8' }
];

const LINKS_B = [
  { quality: 'ORG', url: 'https://cdn.example/b-original.mp4' },
  { quality: '480p', url: 'https://hls.example/b-480.m3u8' },
  { quality: '360p', url: 'https://hls.example/b-360.m3u8' }
];

async function main() {
  const ctx = createSandbox({ fallbackLinks: LINKS_A });
  vm.runInContext(APP_SOURCE, ctx.sandbox, { filename: 'app.js' });
  await flush();
  await flush();

  // First playback: slow connection must select the lowest quality once.
  ctx.sandbox.window.openPlayerModal(1, 'movie');
  await flush();
  await flush();

  assert.strictEqual(ctx.loads.length, 1, 'initial playback should load exactly one URL');
  assert.strictEqual(ctx.loads[0].url, LINKS_A[3].url);
  assert.strictEqual(ctx.loads[0].player, 1);

  const qualityList = ctx.documentStub.getElementById('qualityList');
  assert.strictEqual(qualityList.children.length, LINKS_A.length);
  assert.strictEqual(qualityList.children.findIndex((b) => b.classList.contains('active')), 3);
  assert.strictEqual(ctx.documentStub.getElementById('qualityBadge').textContent, '360p');
  assert.match(ctx.documentStub.getElementById('qualityBadge').title, /slow connection/);
  console.log('PASS initial automatic selection loads 360p exactly once');

  // Manual override: click 1080p and confirm exactly one extra load.
  qualityList.children[1].listeners.click[0]();
  await flush();

  assert.strictEqual(ctx.loads.length, 2, 'manual click should cause exactly one extra load');
  assert.strictEqual(ctx.loads[1].url, LINKS_A[1].url);
  assert.strictEqual(ctx.loads[1].player, 1);
  assert.strictEqual(qualityList.children.findIndex((b) => b.classList.contains('active')), 1);
  assert.strictEqual(ctx.documentStub.getElementById('qualityBadge').title, 'Quality chosen manually');
  console.log('PASS manual selection overrides automatic selection without extra restart');

  // New title: automatic selection resets from the new link set.
  ctx.resolverQueue.push(LINKS_B);
  ctx.sandbox.window.openPlayerModal(1, 'movie');
  await flush();
  await flush();

  assert.strictEqual(ctx.loads.length, 3, 'new playback should load exactly one new URL');
  assert.strictEqual(ctx.loads[2].url, LINKS_B[2].url);
  assert.strictEqual(ctx.loads[2].player, 2);
  assert.strictEqual(ctx.state.created, 2);
  assert.strictEqual(ctx.state.destroyed, 1);
  assert.strictEqual(ctx.documentStub.getElementById('qualityList').children.length, LINKS_B.length);
  assert.strictEqual(
    ctx.documentStub.getElementById('qualityList').children.findIndex((b) => b.classList.contains('active')),
    2
  );
  console.log('PASS new title resets automatic selection and discards previous manual choice');

  console.log('app quality-flow tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
