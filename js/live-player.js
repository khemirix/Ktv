/* Advanced live-stream adapter for Khemirix TV.
 *
 * Uses the existing hls.js, mpegts.js and HTML5 video engines. This module
 * owns engine choice, detection, timeouts, bounded recovery, stream switching,
 * and real audio/subtitle track discovery. It never logs stream URLs or tokens.
 */
var LiveStreamPlayer = (function () {
  var START_TIMEOUT = 15000;
  var MANIFEST_TIMEOUT = 12000;
  var MAX_RECOVERY = 1;

  function create(options) {
    options = options || {};
    var video = options.video;
    var engine = null;
    var token = 0;
    var timer = null;
    var retries = 0;
    var nativeFallbackUsed = false;
    var lastTracks = { audio: [], subtitles: [] };

    function status(state, message) {
      if (typeof options.onStatus === 'function') options.onStatus(state, message || '');
    }
    function problem(message) {
      if (typeof options.onError === 'function') options.onError(message);
    }
    function clearTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function startTimer(message, ms) {
      clearTimer();
      timer = setTimeout(function () {
        if (problem) problem(message);
      }, ms || START_TIMEOUT);
    }
    function reportTracks() {
      if (typeof options.onTracks === 'function') options.onTracks(lastTracks);
    }
    function normalizeAudio(tracks, selected) {
      return Array.prototype.map.call(tracks || [], function (track, i) {
        var lang = track.lang || track.language || (track.attrs && track.attrs.LANGUAGE) || '';
        return {
          index: i,
          language: String(lang),
          label: String(track.name || track.label || lang || ('Track ' + (i + 1))),
          selected: i === selected
        };
      });
    }
    function normalizeSubtitles(tracks, selected) {
      return Array.prototype.map.call(tracks || [], function (track, i) {
        var lang = track.lang || track.language || '';
        return {
          index: i,
          language: String(lang),
          label: String(track.name || track.label || lang || ('Subtitle ' + (i + 1))),
          selected: i === selected
        };
      });
    }

    function teardownEngine() {
      if (!engine) return;
      try {
        if (engine.type === 'hls.js' && engine.player && engine.player.destroy) engine.player.destroy();
        if (engine.type === 'mpegts' && engine.player && engine.player.destroy) engine.player.destroy();
      } catch (e) {}
      engine = null;
    }

    function clearVideo() {
      try { video.pause(); } catch (e) {}
      try { video.removeAttribute('src'); video.load(); } catch (e) {}
    }

    function stop() {
      token += 1;
      clearTimer();
      teardownEngine();
      clearVideo();
      lastTracks = { audio: [], subtitles: [] };
      reportTracks();
      status('idle', '');
    }

    function nativeTracks() {
      var audio = [];
      var subtitles = [];
      if (video.audioTracks) {
        audio = Array.prototype.map.call(video.audioTracks, function (track, i) {
          return { index: i, language: String(track.language || ''), label: String(track.label || track.language || ('Track ' + (i + 1))), selected: !!track.enabled };
        });
      }
      if (video.textTracks) {
        subtitles = Array.prototype.map.call(video.textTracks, function (track, i) {
          if (track.kind === 'metadata' || track.kind === 'chapters') return null;
          return { index: i, language: String(track.language || ''), label: String(track.label || track.language || ('Subtitle ' + (i + 1))), selected: track.mode === 'showing' };
        }).filter(Boolean);
      }
      lastTracks = { audio: audio, subtitles: subtitles };
      reportTracks();
    }

    function playNative(url, myToken, meta) {
      teardownEngine();
      engine = { type: 'native', player: null };
      video.src = url;
      try { video.load(); } catch (e) {}
      var onMeta = function () {
        if (myToken !== token) return;
        video.removeEventListener('loadedmetadata', onMeta);
        clearTimer();
        nativeTracks();
      };
      video.addEventListener('loadedmetadata', onMeta);
      status('loading', meta && meta.label ? 'Connecting to ' + meta.label : 'Connecting…');
      return video.play().catch(function () {});
    }

    function fallbackToNative(url, myToken, message) {
      if (myToken !== token || nativeFallbackUsed) {
        if (myToken === token) problem(message || 'This stream could not be played');
        return;
      }
      nativeFallbackUsed = true;
      problem((message || 'Stream failed') + ' — trying a direct connection');
      playNative(url, myToken, null);
    }

    function playHlsJs(url, myToken, meta, headers) {
      if (!window.Hls || !window.Hls.isSupported()) return false;
      teardownEngine();
      var hlsConfig = {
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60
      };
      if (headers && Object.keys(headers).length) hlsConfig.httpHeaders = headers;
      var hls = new window.Hls(hlsConfig);
      engine = { type: 'hls.js', player: hls };
      var events = window.Hls.Events || {};
      startTimer('The stream took too long to start', MANIFEST_TIMEOUT);

      hls.on(events.MANIFEST_PARSED, function () {
        if (myToken !== token) return;
        clearTimer();
        status('playing', 'Playing ' + ((meta && meta.name) || 'stream'));
        video.play().catch(function () {});
        lastTracks.audio = normalizeAudio(hls.audioTracks || [], hls.audioTrack);
        lastTracks.subtitles = normalizeSubtitles(hls.subtitleTracks || [], hls.subtitleTrack);
        reportTracks();
      });

      hls.on(events.AUDIO_TRACKS_UPDATED, function () {
        if (myToken === token) {
          lastTracks.audio = normalizeAudio(hls.audioTracks || [], hls.audioTrack);
          reportTracks();
        }
      });
      hls.on(events.SUBTITLE_TRACKS_UPDATED, function () {
        if (myToken === token) {
          lastTracks.subtitles = normalizeSubtitles(hls.subtitleTracks || [], hls.subtitleTrack);
          reportTracks();
        }
      });
      hls.on(events.AUDIO_TRACK_SWITCHED, function () {
        if (myToken === token) {
          lastTracks.audio = normalizeAudio(hls.audioTracks || [], hls.audioTrack);
          reportTracks();
        }
      });

      hls.on(events.ERROR, function (event, data) {
        if (myToken !== token || !data) return;
        if (!data.fatal) return;
        if (retries < MAX_RECOVERY) {
          retries += 1;
          var errorTypes = window.Hls.ErrorTypes || {};
          if (data.type === errorTypes.NETWORK_ERROR && hls.startLoad) {
            problem('Network hiccup — retrying');
            hls.startLoad();
            return;
          }
          if (data.type === errorTypes.MEDIA_ERROR && hls.recoverMediaError) {
            problem('Media glitch — recovering');
            hls.recoverMediaError();
            return;
          }
        }
        fallbackToNative(url, myToken, 'HLS playback failed');
      });

      hls.loadSource(url);
      hls.attachMedia(video);
      status('loading', 'Loading stream…');
      return true;
    }

    function playMpegTs(url, myToken, meta, headers) {
      if (!window.mpegts || !window.mpegts.isSupported()) return false;
      teardownEngine();
      var config = { type: 'mpegts', isLive: true, url: url };
      if (headers && Object.keys(headers).length) config.headers = headers;
      var player = window.mpegts.createPlayer(config, {
        enableWorker: true,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        liveBufferLatencyChasing: false,
        liveSync: false,
        liveSyncMaxLatency: 60,
        liveSyncTargetLatency: 30,
        stashInitialSize: 1024 * 1024
      });
      engine = { type: 'mpegts', player: player };
      player.attachMediaElement(video);
      player.load();
      startTimer('The stream took too long to start', START_TIMEOUT);

      var onProgress = function () {
        if (myToken !== token || !video.buffered || !video.buffered.length) return;
        var buffered = video.buffered.end(video.buffered.length - 1) - (video.currentTime || 0);
        if (buffered >= 2) {
          video.removeEventListener('progress', onProgress);
          clearTimer();
          status('playing', 'Playing ' + ((meta && meta.name) || 'stream'));
          video.play().catch(function () {});
        }
      };
      video.addEventListener('progress', onProgress);

      player.on(window.mpegts.Events.ERROR, function (type, detail) {
        if (myToken !== token) return;
        video.removeEventListener('progress', onProgress);
        if (retries < MAX_RECOVERY) {
          retries += 1;
          problem('Stream glitch — retrying');
          try { player.load(); } catch (e) { fallbackToNative(url, myToken, 'MPEG-TS playback failed'); }
          return;
        }
        fallbackToNative(url, myToken, 'MPEG-TS playback failed');
      });
      status('loading', 'Buffering stream…');
      return true;
    }

    function play(url, meta) {
      meta = meta || {};
      var myToken = ++token;
      retries = 0;
      nativeFallbackUsed = false;
      clearTimer();
      teardownEngine();
      clearVideo();
      lastTracks = { audio: [], subtitles: [] };
      reportTracks();
      status('loading', 'Detecting stream format…');

      var headers = meta.headers || options.headers || {};
      var detectionPromise = (window.StreamDetector && StreamDetector.fromMetadata(url, meta))
        ? StreamDetector.fromMetadata(url, meta)
        : Promise.resolve(null);
      if (!detectionPromise) detectionPromise = Promise.resolve(null);

      return detectionPromise.then(function (forced) {
        if (forced) return forced;
        if (window.StreamDetector && StreamDetector.detect) return StreamDetector.detect(url, {
          headers: headers,
          credentials: meta.credentials || options.credentials || 'omit',
          timeout: meta.timeout || options.timeout
        });
        return { kind: (window.StreamDetector && StreamDetector.extensionKind(url)) || 'unknown', mime: '', finalUrl: url, headers: headers };
      }).then(function (result) {
        if (myToken !== token) return false;
        var finalUrl = result.finalUrl || url;
        var kind = result.kind || 'unknown';

        if (kind === 'mpegts' && playMpegTs(finalUrl, myToken, meta, headers)) return true;
        if (kind === 'hls') {
          if (options.nativeHls && video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
            return playNative(finalUrl, myToken, meta);
          }
          if (playHlsJs(finalUrl, myToken, meta, headers)) return true;
          return playNative(finalUrl, myToken, meta);
        }
        if (kind === 'progressive' || kind === 'audio') return playNative(finalUrl, myToken, meta);

        // Unknown but reachable: try the standard video element first so an
        // extensionless MP4/MKV works before considering HLS or raw TS.
        if (playNative(finalUrl, myToken, meta)) {
          startTimer('This stream did not start', START_TIMEOUT);
          return true;
        }
        return false;
      }).catch(function () {
        if (myToken === token) problem('This stream could not be reached');
        return false;
      });
    }

    function setAudioTrack(index) {
      if (engine && engine.type === 'hls.js' && engine.player) {
        if (!engine.player.audioTracks || engine.player.audioTracks.length < 2) return false;
        try { engine.player.audioTrack = Number(index); return true; } catch (e) { return false; }
      }
      if (video.audioTracks && video.audioTracks.length > 1) {
        try {
          for (var i = 0; i < video.audioTracks.length; i++) video.audioTracks[i].enabled = (i === Number(index));
          return true;
        } catch (e) { return false; }
      }
      return false;
    }

    function setSubtitleTrack(index) {
      var off = Number(index) < 0;
      if (engine && engine.type === 'hls.js' && engine.player) {
        if (!engine.player.subtitleTracks || !engine.player.subtitleTracks.length) return false;
        try { engine.player.subtitleTrack = off ? -1 : Number(index); return true; } catch (e) { return false; }
      }
      if (video.textTracks && video.textTracks.length) {
        try {
          for (var i = 0; i < video.textTracks.length; i++) {
            var shouldShow = !off && i === Number(index);
            video.textTracks[i].mode = shouldShow ? 'showing' : 'disabled';
          }
          return true;
        } catch (e) { return false; }
      }
      return false;
    }

    return {
      play: play,
      stop: stop,
      switchStream: function (url, meta) { return play(url, meta); },
      getAudioTracks: function () { return lastTracks.audio.slice(); },
      getSubtitleTracks: function () { return lastTracks.subtitles.slice(); },
      setAudioTrack: setAudioTrack,
      setSubtitleTrack: setSubtitleTrack,
      destroy: function () { stop(); }
    };
  }

  return { create: create };
})();
