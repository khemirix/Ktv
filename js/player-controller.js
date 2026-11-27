/* PlayerController: the single public API used by the custom player UI.
 *
 * It owns playback state and delegates streaming to MediaPlayer and subtitles
 * to Subtitles. A future Samsung AVPlay adapter can replace MediaPlayer behind
 * this same contract without changing PlayerUI.
 */
var PlayerController = (function () {
  var QUALITY_PREF_KEY = 'ktv_quality_pref';
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  function storageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function qualityLabel(link, index) {
    return (link && (link.quality || link.name)) || ('Link ' + (index + 1));
  }
  function findQualityIndex(links, label) {
    if (!label) return -1;
    var target = String(label).toLowerCase();
    for (var i = 0; i < links.length; i++) {
      if (String(qualityLabel(links[i], i)).toLowerCase() === target) return i;
    }
    return -1;
  }
  function hintFor(tier, saved) {
    if (saved) return 'Saved quality preference: ' + saved;
    if (tier === 'high') return 'Highest quality selected automatically for a fast connection';
    if (tier === 'low') return 'Lowest quality selected automatically for a slow connection';
    if (tier === 'medium') return 'Balanced quality selected automatically for your connection';
    return 'Conservative quality selected automatically — network speed unavailable';
  }
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var total = Math.floor(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
             : m + ':' + String(s).padStart(2, '0');
  }

  function create(options) {
    options = options || {};
    var video = options.video || document.getElementById('playerVideo');
    var listeners = {};
    var token = 0;
    var player = null;
    var subs = null;
    var unsubscribeAudio = null;
    var desiredAudio = null;
    var switchingAudio = false;
    var toastTimer = null;

    var state = {
      title: '',
      status: 'idle', // idle | loading | buffering | playing | paused | ended | error
      error: '',
      notice: '',
      links: [],
      selectedIndex: -1,
      selectedUrl: '',
      fallbackUrl: '',
      tier: 'unknown',
      hint: '',
      qualityLabel: '',
      qualityDisplay: '—',
      remembered: !!storageGet(QUALITY_PREF_KEY),
      currentTime: 0,
      duration: 0,
      buffered: 0,
      volume: 1,
      muted: false,
      playbackRate: 1,
      fullscreen: false,
      audioTracks: [],
      currentAudioTrack: -1,
      subtitleStatus: 'idle',
      subtitleName: '',
      subtitleEnabled: true,
      subtitleLanguage: 'ar',
      subtitleLanguages: [],
      subtitleChoices: [],
      subtitleSelectedId: '',
      subtitleProvider: 'auto',
      subtitleSize: 'medium',
      subtitleBackground: 'dark'
    };

    function emit(event, data) {
      (listeners[event] || []).slice().forEach(function (fn) {
        try { fn(data); } catch (e) {}
      });
    }

    function snapshot() {
      return {
        title: state.title,
        status: state.status,
        error: state.error,
        notice: state.notice,
        links: state.links.slice(),
        selectedIndex: state.selectedIndex,
        selectedUrl: state.selectedUrl,
        tier: state.tier,
        hint: state.hint,
        qualityLabel: state.qualityLabel,
        qualityDisplay: state.qualityDisplay,
        remembered: state.remembered,
        currentTime: state.currentTime,
        duration: state.duration,
        buffered: state.buffered,
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        fullscreen: state.fullscreen,
        audioTracks: state.audioTracks.slice(),
        currentAudioTrack: state.currentAudioTrack,
        subtitleStatus: state.subtitleStatus,
        subtitleName: state.subtitleName,
        subtitleEnabled: state.subtitleEnabled,
        subtitleLanguage: state.subtitleLanguage,
        subtitleLanguages: state.subtitleLanguages.slice(),
        subtitleChoices: state.subtitleChoices.slice(),
        subtitleSelectedId: state.subtitleSelectedId,
        subtitleProvider: state.subtitleProvider,
        subtitleSize: state.subtitleSize,
        subtitleBackground: state.subtitleBackground,
        speeds: SPEEDS.slice(),
        formattedCurrentTime: formatTime(state.currentTime),
        formattedDuration: formatTime(state.duration)
      };
    }

    function emitState() {
      emit('statechange', snapshot());
    }

    function notice(message) {
      state.notice = message || '';
      emit('notice', state.notice);
      emitState();
      if (toastTimer) clearTimeout(toastTimer);
      if (state.notice) {
        toastTimer = setTimeout(function () {
          state.notice = '';
          emit('notice', '');
          emitState();
        }, 3500);
      }
    }

    function showError(message) {
      state.error = message || 'Playback failed.';
      state.status = 'error';
      emit('error', state.error);
      emitState();
    }

    function updateTime() {
      state.currentTime = video.currentTime || 0;
      state.duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      var end = 0;
      if (video.buffered && video.buffered.length && state.duration) {
        try { end = video.buffered.end(video.buffered.length - 1); } catch (e) {}
      }
      state.buffered = state.duration ? clamp(end / state.duration, 0, 1) : 0;
      emit('timeupdate', snapshot());
    }

    function onPlay() {
      if (state.status === 'error') return;
      state.status = 'playing';
      updateTime();
      emitState();
    }
    function onPause() {
      if (state.status === 'error' || state.status === 'ended') return;
      state.status = 'paused';
      emitState();
    }
    function onWaiting() {
      if (state.status === 'error') return;
      state.status = 'buffering';
      emitState();
    }
    function onEnded() {
      state.status = 'ended';
      emit('ended', snapshot());
      emitState();
    }
    function onVolume() {
      state.volume = typeof video.volume === 'number' ? video.volume : 1;
      state.muted = !!video.muted;
      emitState();
    }
    function onRate() {
      state.playbackRate = video.playbackRate || 1;
      emitState();
    }
    function onFullscreen() {
      state.fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
      emitState();
    }

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('progress', updateTime);
    video.addEventListener('durationchange', updateTime);
    video.addEventListener('loadedmetadata', updateTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('ratechange', onRate);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);

    function markQuality(index, url) {
      state.selectedIndex = index;
      state.qualityLabel = qualityLabel(state.links[index], index);
      state.qualityDisplay = state.qualityLabel;
      if (subs && typeof subs.resync === 'function') subs.resync();
      emit('qualitychange', state.qualityLabel);
      emitState();
    }

    function markFallback(url) {
      state.qualityLabel = '';
      state.qualityDisplay = 'Direct';
      state.hint = 'Playing the direct video fallback';
      emitState();
    }

    function captureAudioSelection() {
      var current = state.audioTracks.filter(function (t) { return t.selected; })[0];
      if (!current && state.currentAudioTrack >= 0) {
        current = state.audioTracks[state.currentAudioTrack];
      }
      return current ? { language: current.language, label: current.label } : null;
    }

    function restoreAudioSelection(tracks) {
      if (!desiredAudio || switchingAudio || tracks.length < 2) return;
      var match = tracks.filter(function (t) {
        return (desiredAudio.language && t.language === desiredAudio.language) ||
               (desiredAudio.label && t.label === desiredAudio.label);
      })[0];
      if (match && match.index !== state.currentAudioTrack) {
        switchingAudio = true;
        if (player) player.setAudioTrack(match.index);
        setTimeout(function () { switchingAudio = false; }, 0);
      }
      desiredAudio = null;
    }

    function onAudioTracksChanged(tracks, current) {
      state.audioTracks = tracks.slice();
      state.currentAudioTrack = current;
      restoreAudioSelection(state.audioTracks);
      emit('audiochange', snapshot());
      emitState();
    }

    function resolveSubtitleMeta(opts, myToken) {
      var meta = {
        imdbId: opts.imdbId || null,
        type: opts.type || 'movie',
        title: opts.title || '',
        season: opts.season,
        episode: opts.episode
      };
      var ready = Promise.resolve(meta);
      if (!meta.imdbId && opts.tmdbId && window.TMDB && TMDB.getImdbId) {
        ready = TMDB.getImdbId(meta.type, opts.tmdbId).then(function (id) {
          meta.imdbId = id;
          return meta;
        }).catch(function () { return meta; });
      }
      return ready.then(function (result) {
        if (myToken !== token) return null;
        return result;
      });
    }

    function attachSubtitles(opts, myToken) {
      return resolveSubtitleMeta(opts, myToken).then(function (meta) {
        if (!meta || myToken !== token) return;
        var style = Subtitles.applyStyle();
        state.subtitleSize = style.size;
        state.subtitleBackground = style.background;
        state.subtitleProvider = validStoredProvider();
        subs = Subtitles.attach(video, meta, function (status, name, info) {
          if (myToken !== token) return;
          state.subtitleStatus = status;
          state.subtitleName = name || '';
          state.subtitleEnabled = status !== 'off';
          if (info) {
            state.subtitleLanguages = info.languages || [];
            state.subtitleChoices = info.choices || [];
            state.subtitleSelectedId = info.selectedId || '';
            state.subtitleProvider = info.provider || state.subtitleProvider;
            state.subtitleLanguage = info.language || state.subtitleLanguage;
          }
          emit('subtitlechange', snapshot());
          emitState();
        }, {
          enabled: true,
          provider: state.subtitleProvider,
          language: state.subtitleLanguage
        });
      });
    }

    function validStoredProvider() {
      var saved = storageGet('ktv_sub_provider');
      var known = (window.Subtitles && Subtitles.providers) || [];
      return known.some(function (p) { return p.id === saved; }) ? saved : 'auto';
    }

    function open(links, title, opts) {
      var myToken = ++token;
      opts = opts || {};
      if (!opts.title) opts.title = title || '';
      if (player) { player.destroy(); player = null; }
      if (subs) { subs.destroy(); subs = null; }
      if (unsubscribeAudio) { unsubscribeAudio(); unsubscribeAudio = null; }
      desiredAudio = null;
      switchingAudio = false;

      state.links = Array.isArray(links) ? links.slice() : [];
      state.title = title || '';
      state.status = 'loading';
      state.error = '';
      state.qualityLabel = '';
      state.qualityDisplay = '—';
      state.selectedIndex = -1;
      state.selectedUrl = '';
      state.audioTracks = [];
      state.currentAudioTrack = -1;
      state.subtitleStatus = 'loading';
      state.subtitleName = '';
      state.subtitleLanguages = ((window.Subtitles && Subtitles.languages) || []).map(function (lang) {
        return { code: lang.code, label: lang.label, count: 0 };
      });
      state.subtitleChoices = [];
      state.subtitleSelectedId = '';
      state.subtitleProvider = validStoredProvider();
      state.subtitleLanguage = storageGet('ktv_sub_lang') || 'ar';
      state.remembered = !!storageGet(QUALITY_PREF_KEY);
      emitState();

      if (!state.links.length) {
        showError('No stream links are available for this file right now');
        return Promise.resolve(false);
      }

      return MediaPlayer.estimateNetworkTier().then(function (tier) {
        if (myToken !== token) return false;
        state.tier = tier;
        var saved = storageGet(QUALITY_PREF_KEY);
        var prefIndex = findQualityIndex(state.links, saved);
        var index = prefIndex >= 0 ? prefIndex : MediaPlayer.chooseDefault(state.links, tier);
        index = clamp(index, 0, state.links.length - 1);
        state.selectedIndex = index;
        state.selectedUrl = state.links[index].url;
        state.fallbackUrl = MediaPlayer.fallbackFor(state.links, tier);
        state.hint = hintFor(tier, prefIndex >= 0 ? saved : '');
        state.qualityDisplay = 'Loading ' + qualityLabel(state.links[index], index) + '…';
        emitState();

        player = MediaPlayer.create(video, {
          onError: function (message, fatal) {
            if (myToken !== token) return;
            if (fatal) showError(message);
            else notice(message);
          },
          onAutoplayBlocked: function () {
            if (myToken === token) notice('Press play to start the video');
          },
          onPlaying: function (info) {
            if (myToken !== token || !info) return;
            var playingIndex = -1;
            for (var i = 0; i < state.links.length; i++) {
              if (state.links[i].url === info.url) { playingIndex = i; break; }
            }
            if (playingIndex >= 0) {
              markQuality(playingIndex, info.url);
              if (subs) subs.resync();
            } else if (info.url === state.fallbackUrl) {
              markFallback(info.url);
              if (subs) subs.resync();
            }
          },
          onAudioTracksChanged: onAudioTracksChanged
        });
        unsubscribeAudio = player.onAudioTracksChanged(onAudioTracksChanged);

        player.load(state.selectedUrl, {
          fallbackUrl: state.selectedUrl === state.fallbackUrl ? '' : state.fallbackUrl,
          autoplay: true
        });
        attachSubtitles(opts, myToken);
        return true;
      }).catch(function (err) {
        if (myToken === token) showError((err && err.message) || 'Playback could not be started.');
        return false;
      });
    }

    function selectQuality(index) {
      index = Number(index);
      if (!player || index < 0 || index >= state.links.length) return false;
      var link = state.links[index];
      if (link.url === state.selectedUrl) return false;

      desiredAudio = captureAudioSelection();
      state.selectedUrl = link.url;
      state.selectedIndex = index;
      state.qualityLabel = '';
      state.qualityDisplay = 'Loading ' + qualityLabel(link, index) + '…';
      state.hint = 'Waiting for ' + qualityLabel(link, index) + ' to start';
      emitState();

      player.load(link.url, {
        fallbackUrl: link.url === state.fallbackUrl ? '' : state.fallbackUrl,
        autoplay: true
      });
      if (subs && typeof subs.forceReload === 'function') subs.forceReload();
      return true;
    }

    function rememberQuality(on) {
      if (on) {
        if (!state.qualityLabel) return false;
        storageSet(QUALITY_PREF_KEY, state.qualityLabel);
      } else {
        storageRemove(QUALITY_PREF_KEY);
      }
      state.remembered = !!storageGet(QUALITY_PREF_KEY);
      emitState();
      return true;
    }

    function play() {
      try {
        var result = video.play();
        if (result && typeof result.catch === 'function') {
          result.catch(function () { notice('Press play to start the video'); });
        }
      } catch (e) { notice('Playback could not start on this device'); }
    }
    function pause() { try { video.pause(); } catch (e) {} }
    function togglePlay() {
      if (video.paused || video.ended) play();
      else pause();
    }
    function seekTo(seconds) {
      if (!isFinite(state.duration) || state.duration <= 0) return;
      video.currentTime = clamp(seconds, 0, state.duration);
      updateTime();
    }
    function skip(delta) { seekTo((video.currentTime || 0) + Number(delta || 0)); }
    function setVolume(value) {
      video.volume = clamp(Number(value), 0, 1);
      if (video.volume > 0 && video.muted) video.muted = false;
      onVolume();
    }
    function toggleMute() { video.muted = !video.muted; onVolume(); }
    function setPlaybackRate(rate) {
      rate = Number(rate);
      if (SPEEDS.indexOf(rate) === -1) return false;
      video.playbackRate = rate;
      onRate();
      return true;
    }
    function toggleFullscreen() {
      var el = options.fullscreenElement || document.getElementById('playerStage') || video;
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          var exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) {
            var p = exit.call(document);
            if (p && p.catch) p.catch(function () { notice('Fullscreen could not be exited'); });
          }
        } else {
          var request = el.requestFullscreen || el.webkitRequestFullscreen;
          if (!request) { notice('Fullscreen is not supported here'); return; }
          var p2 = request.call(el);
          if (p2 && p2.catch) p2.catch(function () { notice('Fullscreen could not be started'); });
        }
      } catch (e) { notice('Fullscreen is unavailable in this browser'); }
    }

    function setSubtitleEnabled(on) { if (subs) subs.setEnabled(on); }
    function setSubtitleProvider(id) {
      if (subs) subs.setProvider(id);
      state.subtitleProvider = id;
      emitState();
    }
    function setSubtitleLanguage(code) {
      if (!subs) return false;
      var ok = subs.setLanguage(code);
      if (ok) {
        state.subtitleLanguage = code;
        state.subtitleSelectedId = '';
        state.subtitleName = '';
        state.subtitleStatus = 'none';
        emitState();
      }
      return ok;
    }
    function chooseSubtitle(id) {
      if (!subs || typeof subs.selectSubtitle !== 'function') return false;
      var ok = subs.selectSubtitle(id);
      if (ok) {
        var choices = state.subtitleChoices.slice();
        for (var i = 0; i < choices.length; i++) {
          if (String(choices[i].id) === String(id)) state.subtitleName = choices[i].name || '';
        }
        state.subtitleSelectedId = String(id);
        emitState();
      }
      return ok;
    }
    function setSubtitleSize(size) {
      if (subs) subs.setSize(size);
      else Subtitles.applyStyle();
      state.subtitleSize = size;
      emitState();
    }
    function setSubtitleBackground(bg) {
      if (subs) subs.setBackground(bg);
      else Subtitles.applyStyle();
      state.subtitleBackground = bg;
      emitState();
    }

    function setAudioTrack(index) {
      if (!player) return false;
      var ok = player.setAudioTrack(index);
      if (ok) {
        desiredAudio = null;
        state.currentAudioTrack = Number(index);
        emit('audiochange', snapshot());
        emitState();
      }
      return ok;
    }

    function close() {
      token += 1;
      if (player) { player.destroy(); player = null; }
      if (subs) { subs.destroy(); subs = null; }
      if (unsubscribeAudio) { unsubscribeAudio(); unsubscribeAudio = null; }
      desiredAudio = null;
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      state.status = 'idle';
      state.links = [];
      state.audioTracks = [];
      emitState();
    }

    function destroy() {
      close();
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('progress', updateTime);
      video.removeEventListener('durationchange', updateTime);
      video.removeEventListener('loadedmetadata', updateTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('ratechange', onRate);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
    }

    state.volume = typeof video.volume === 'number' ? video.volume : 1;
    state.muted = !!video.muted;
    state.playbackRate = video.playbackRate || 1;
    emitState();

    return {
      on: function (event, fn) {
        if (typeof fn !== 'function') return function () {};
        (listeners[event] || (listeners[event] = [])).push(fn);
        return function () {
          listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
        };
      },
      off: function (event, fn) {
        listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
      },
      getState: snapshot,
      getAudioTracks: function () { return state.audioTracks.slice(); },
      getCurrentAudioTrack: function () { return state.currentAudioTrack; },
      open: open,
      close: close,
      destroy: destroy,
      showError: showError,
      notice: notice,
      play: play,
      pause: pause,
      togglePlay: togglePlay,
      seekTo: seekTo,
      skip: skip,
      setVolume: setVolume,
      toggleMute: toggleMute,
      setPlaybackRate: setPlaybackRate,
      toggleFullscreen: toggleFullscreen,
      selectQuality: selectQuality,
      rememberQuality: rememberQuality,
      setSubtitleEnabled: setSubtitleEnabled,
      setSubtitleProvider: setSubtitleProvider,
      setSubtitleLanguage: setSubtitleLanguage,
      chooseSubtitle: chooseSubtitle,
      setSubtitleSize: setSubtitleSize,
      setSubtitleBackground: setSubtitleBackground,
      setAudioTrack: setAudioTrack,
      resyncSubtitles: function () { if (subs) subs.resync(); }
    };
  }

  return { create: create, QUALITY_PREF_KEY: QUALITY_PREF_KEY, SPEEDS: SPEEDS, formatTime: formatTime };
})();
