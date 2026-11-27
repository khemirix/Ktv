'use strict';

// Feature checks for the custom player shell: real audio-track gating,
// subtitle provider controls, keyboard shortcuts, auto-hide, and errors.
// Run with: node tests/player-features.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MEDIA_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'media-player.js'), 'utf8');
const CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'player-controller.js'), 'utf8');
const UI_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'player-ui.js'), 'utf8');
const RESOLVER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'resolver.js'), 'utf8');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeEl(id, tagName) {
  const el = {
    id: id || '',
    tagName: (tagName || 'div').toUpperCase(),
    hidden: false,
    disabled: false,
    textContent: '',
    title: '',
    value: '',
    currentTime: 0,
    duration: 100,
    volume: 0.5,
    muted: false,
    playbackRate: 1,
    paused: true,
    style: { setProperty() {} },
    dataset: {},
    children: [],
    listeners: {},
    attrs: {},
    calls: { play: 0, pause: 0, requestFullscreen: 0 },
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
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
    contains(node) { return this === node || this.children.indexOf(node) !== -1; },
    getBoundingClientRect() { return { left: 0, width: 100, top: 0, height: 10 }; },
    focus() {},
    play() { this.calls.play += 1; this.paused = false; return Promise.resolve(); },
    pause() { this.calls.pause += 1; this.paused = true; },
    load() {},
    removeAttribute() {},
    requestFullscreen() {
      this.calls.requestFullscreen += 1;
      docStub.fullscreenElement = this;
      return Promise.resolve();
    }
  };

  const classSet = new Set();
  el.classList = {
    add(...names) { names.forEach((name) => classSet.add(name)); },
    remove(...names) { names.forEach((name) => classSet.delete(name)); },
    contains(name) { return classSet.has(name); },
    toggle(name, force) {
      if (force === undefined) force = !classSet.has(name);
      if (force) classSet.add(name); else classSet.delete(name);
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

let docStub;

function createContext(initialTracks) {
  const elements = new Map();
  const storage = new Map();
  const loads = [];
  const subtitleCalls = [];
  const audioCalls = [];
  const timers = [];
  const state = { lastController: null };
  let tracks = initialTracks.map((track) => Object.assign({}, track));

  docStub = {
    fullscreenElement: null,
    body: makeEl('body'),
    head: makeEl('head'),
    documentElement: makeEl('html'),
    activeElement: null,
    listeners: {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    createElement(tag) { return makeEl('', tag); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    removeEventListener() {},
    exitFullscreen() {
      this.fullscreenElement = null;
      return Promise.resolve();
    }
  };

  const windowStub = {
    location: { href: 'https://site.example/index.html' },
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document: docStub,
    window: windowStub,
    navigator: { userAgent: 'node', connection: { effectiveType: '4g', downlink: 10 } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    URLSearchParams,
    URL,
    AbortController,
    performance: { now: () => 0 },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
    setImmediate,
    fetch: () => Promise.reject(new Error('network probe disabled in this test'))
  };

  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SOURCE, sandbox, { filename: 'media-player.js' });
  const realMediaPlayer = sandbox.MediaPlayer;

  sandbox.MediaPlayer = {
    isHls: realMediaPlayer.isHls,
    networkTier: realMediaPlayer.networkTier,
    estimateNetworkTier: realMediaPlayer.estimateNetworkTier,
    chooseDefault: realMediaPlayer.chooseDefault,
    fallbackFor: realMediaPlayer.fallbackFor,
    qualityRank: realMediaPlayer.qualityRank,
    create(video, handlers) {
      const audioListeners = [];
      const controller = {
        load(url, opts) {
          loads.push({ url, opts, handlers });
          const selected = tracks.findIndex((track) => track.selected);
          audioListeners.slice().forEach((fn) => fn(tracks.slice(), selected));
        },
        destroy() {},
        resync() {},
        kind() { return 'stub'; },
        getAudioTracks() { return tracks.slice(); },
        getCurrentAudioTrack() { return tracks.findIndex((track) => track.selected); },
        setAudioTrack(index) {
          audioCalls.push(index);
          tracks = tracks.map((track, i) => Object.assign({}, track, { selected: i === index }));
          audioListeners.slice().forEach((fn) => fn(tracks.slice(), index));
          return true;
        },
        onAudioTracksChanged(fn) {
          audioListeners.push(fn);
          return function () {};
        }
      };
      controller.emitPlaying = (url) => handlers.onPlaying({ url, kind: 'stub' });
      state.lastController = controller;
      return controller;
    }
  };

  sandbox.TMDB = { getImdbId: () => Promise.resolve('tt1234567') };
  sandbox.Subtitles = {
    providers: [
      { id: 'auto', label: 'Auto' },
      { id: 'mysubs', label: 'MySubs' },
      { id: 'subtitles-website', label: 'subtitles.website' },
      { id: 'subdl', label: 'SubDL' },
      { id: 'wyzie', label: 'Wyzie Subs' },
      { id: 'opensubtitles', label: 'OpenSubtitles.com' }
    ],
    applyStyle() { subtitleCalls.push(['applyStyle']); return { size: 'medium', background: 'dark' }; },
    attach() {
      const manager = {
        setEnabled(on) { subtitleCalls.push(['setEnabled', on]); },
        setProvider(id) { subtitleCalls.push(['setProvider', id]); },
        setLanguage(code) {
          subtitleCalls.push(['setLanguage', code]);
          return true;
        },
        selectSubtitle(id) {
          subtitleCalls.push(['selectSubtitle', id]);
          return true;
        },
        setSize(size) { subtitleCalls.push(['setSize', size]); },
        setBackground(bg) { subtitleCalls.push(['setBackground', bg]); },
        resync() { subtitleCalls.push(['resync']); },
        forceReload() { subtitleCalls.push(['forceReload']); },
        getState() { return { status: 'on', languages: [{ code: 'ar', label: 'العربية' }], enabled: true }; },
        destroy() { subtitleCalls.push(['destroy']); }
      };
      return manager;
    }
  };

  vm.runInContext(CONTROLLER_SOURCE, sandbox, { filename: 'player-controller.js' });
  vm.runInContext(UI_SOURCE, sandbox, { filename: 'player-ui.js' });

  return {
    sandbox,
    loads,
    subtitleCalls,
    audioCalls,
    timers,
    state,
    getTracks: () => tracks.slice(),
    fireTimers(ms) {
      timers.slice().forEach((timer) => {
        if (ms === undefined || timer.ms === ms) timer.fn();
      });
    }
  };
}

function emitVideoEvent(name) {
  const video = docStub.getElementById('playerVideo');
  (video.listeners[name] || []).slice().forEach((fn) => fn());
}

function dispatchKey(ctx, key, target) {
  const event = {
    key: key === 'Back' ? undefined : key,
    keyCode: key === 'Back' ? 10009 : 0,
    target: target || null,
    preventDefault() { event.prevented = true; },
    prevented: false
  };
  (docStub.listeners.keydown || []).slice().forEach((fn) => fn(event));
  return event;
}

const LINKS = [
  { quality: '1080p', url: 'https://hls.example/main-1080.m3u8' },
  { quality: '720p', url: 'https://hls.example/main-720.m3u8' }
];

async function main() {
  // 1. Audio menu never invents tracks.
  const pureUi = createContext([]).sandbox.PlayerUI;
  assert.strictEqual(pureUi.audioMenuVisible([]), false);
  assert.strictEqual(pureUi.audioMenuVisible([{ index: 0, language: 'en' }]), false);
  assert.strictEqual(pureUi.audioMenuVisible([
    { index: 0, language: 'en' },
    { index: 1, language: 'ar' }
  ]), true);
  console.log('PASS audio menu stays hidden for zero or one real track');

  const tracks = [
    { index: 0, language: 'en', label: 'English', selected: true },
    { index: 1, language: 'ar', label: 'العربية', selected: false }
  ];
  const ctx = createContext(tracks);
  const player = ctx.sandbox.PlayerController.create({
    video: docStub.getElementById('playerVideo')
  });
  const ui = ctx.sandbox.PlayerUI.create(player, { onClose() { ctx.closeCalls = (ctx.closeCalls || 0) + 1; } });
  docStub.getElementById('settingsMenu').hidden = true;
  ui.open();

  await player.open(LINKS, 'Audio Test', { type: 'movie', tmdbId: 123 });
  await flush();

  const videoStub = docStub.getElementById('playerVideo');
  (videoStub.listeners.timeupdate || []).slice().forEach((fn) => fn());

  const audioRow = docStub.getElementById('audioMenuRow');
  const audioList = docStub.getElementById('audioList');
  assert.strictEqual(audioRow.hidden, false);
  assert.strictEqual(audioList.children.length, 2);
  assert.strictEqual(docStub.getElementById('audioSummary').textContent, '2 tracks');
  console.log('PASS multiple real audio tracks populate the menu');

  assert.strictEqual(player.setAudioTrack(1), true);
  assert.strictEqual(player.getState().currentAudioTrack, 1);
  assert.strictEqual(ctx.audioCalls[0], 1);
  console.log('PASS selecting an audio track calls the playback adapter');

  player.selectQuality(1);
  ctx.state.lastController.emitPlaying(LINKS[1].url);
  await flush();
  assert.ok(ctx.audioCalls.indexOf(1) !== -1);
  assert.strictEqual(player.getState().currentAudioTrack, 1);
  console.log('PASS audio selection survives a quality switch');

  // 2. Subtitle controls forward every setting.
  player.setSubtitleEnabled(false);
  player.setSubtitleProvider('mysubs');
  player.setSubtitleLanguage('ar');
  player.setSubtitleSize('large');
  player.setSubtitleBackground('solid');
  const names = ctx.subtitleCalls.map((call) => call[0]);
  assert.ok(names.indexOf('setEnabled') !== -1);
  assert.ok(names.indexOf('setProvider') !== -1);
  assert.ok(names.indexOf('setLanguage') !== -1);
  assert.ok(names.indexOf('setSize') !== -1);
  assert.ok(names.indexOf('setBackground') !== -1);
  assert.ok(names.indexOf('resync') !== -1);
  console.log('PASS subtitle enable, provider, language, size, background, and resync work');

  // 3. Keyboard shortcuts and menu navigation.
  const video = videoStub;
  video.currentTime = 50;
  let event = dispatchKey(ctx, 'ArrowLeft');
  assert.strictEqual(event.prevented, true);
  assert.strictEqual(video.currentTime, 40);
  dispatchKey(ctx, 'ArrowRight');
  assert.strictEqual(video.currentTime, 50);
  dispatchKey(ctx, 'ArrowUp');
  emitVideoEvent('volumechange');
  assert.strictEqual(video.volume, 0.6);
  dispatchKey(ctx, 'ArrowDown');
  emitVideoEvent('volumechange');
  assert.strictEqual(video.volume, 0.5);
  dispatchKey(ctx, 'm');
  assert.strictEqual(video.muted, true);
  dispatchKey(ctx, 'f');
  assert.strictEqual(docStub.getElementById('playerStage').calls.requestFullscreen, 1);
  const beforeSpace = video.calls.play;
  dispatchKey(ctx, ' ');
  assert.strictEqual(video.calls.play, beforeSpace + 1);
  console.log('PASS Space, arrows, M, and F keyboard shortcuts work');

  const beforeIgnored = video.currentTime;
  dispatchKey(ctx, 'ArrowLeft', { tagName: 'INPUT', isContentEditable: false });
  assert.strictEqual(video.currentTime, beforeIgnored);
  console.log('PASS keyboard shortcuts ignore text inputs');

  ui.openSettings('quality');
  assert.strictEqual(docStub.getElementById('settingsMenu').hidden, false);
  dispatchKey(ctx, 'Escape');
  assert.strictEqual(docStub.getElementById('settingsMenu').hidden, true);
  assert.strictEqual(ctx.closeCalls || 0, 0);
  assert.strictEqual(docStub.getElementById('playerModal').classList.contains('active'), true);
  dispatchKey(ctx, 'Back');
  assert.strictEqual(ctx.closeCalls || 0, 1);
  console.log('PASS Escape and TV Back close menus first, then the player');

  // 4. Controls auto-hide while playing but not while a menu is open.
  player.pause();
  emitVideoEvent('pause');
  ui.showControls();
  assert.strictEqual(docStub.getElementById('playerStage').classList.contains('controls-hidden'), false);
  player.play();
  emitVideoEvent('play');
  ui.showControls();
  ctx.fireTimers(3200);
  assert.strictEqual(docStub.getElementById('playerStage').classList.contains('controls-hidden'), true);
  ui.openSettings('quality');
  assert.strictEqual(docStub.getElementById('playerStage').classList.contains('controls-hidden'), false);
  console.log('PASS controls auto-hide while playing and stay visible with menus open');

  // 5. Empty links keep the exact friendly message.
  await player.open([], 'Empty', { type: 'movie' });
  await flush();
  assert.strictEqual(
    docStub.getElementById('playerErrorMsg').textContent,
    'No stream links are available for this file right now'
  );
  assert.strictEqual(docStub.getElementById('playerStateError').hidden, false);
  console.log('PASS friendly no-links error is preserved');

  assert.ok(RESOLVER_SOURCE.indexOf('This film is not available yet — please check another day') !== -1);
  console.log('PASS resolver unavailable-film message is preserved');

  console.log('player feature tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
