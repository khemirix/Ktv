/* PlayerUI: custom cinematic controls for Khemirix TV.
 *
 * This module never resolves URLs or touches HLS internals. It calls the
 * PlayerController API and renders controller state. All controls are real
 * buttons with visible focus, Enter/OK activation, and arrow-key navigation.
 */
var PlayerUI = (function () {
  function el(id) { return document.getElementById(id); }
  function icon(name, extra) {
    return '<i class="fas fa-' + name + '"></i>' + (extra || '');
  }
  function show(node, visible) {
    if (node) node.hidden = !visible;
  }
  function text(node, value) {
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }
  function setIcon(node, name, extra) {
    if (node) node.innerHTML = icon(name, extra);
  }
  function audioMenuVisible(tracks) {
    return Array.isArray(tracks) && tracks.length > 1;
  }

  function create(controller, options) {
    options = options || {};
    var modal = el('playerModal');
    var stage = el('playerStage');
    var settings = el('settingsMenu');
    var hideTimer = null;
    var currentPanel = 'main';
    var lastLinkKey = '';
    var lastAudioKey = '';
    var lastLanguageKey = '';
    var lastProviderKey = '';
    var lastSpeedKey = '';
    var scrubbing = false;

    function settingsOpen() {
      return !!(settings && !settings.hidden);
    }

    function open() {
      if (modal) modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      showControls();
    }

    function close() {
      if (modal) modal.classList.remove('active');
      document.body.style.overflow = '';
      closeSettings();
      if (hideTimer) clearTimeout(hideTimer);
    }

    function hideControls() {
      if (!stage || settingsOpen()) return;
      var s = controller.getState();
      if (s.status === 'playing' || s.status === 'buffering') stage.classList.add('controls-hidden');
    }

    function showControls() {
      if (stage) stage.classList.remove('controls-hidden');
      if (hideTimer) clearTimeout(hideTimer);
      var s = controller.getState();
      if ((s.status === 'playing' || s.status === 'buffering') && !settingsOpen()) {
        hideTimer = setTimeout(hideControls, 3200);
      }
    }

    function openSettings(panel) {
      if (!settings) return;
      settings.hidden = false;
      showPanel(panel || 'main');
      showControls();
      var first = settings.querySelector('.pv-settings-panel:not([hidden]) .pv-menu-row, ' +
        '.pv-settings-panel:not([hidden]) .pv-wide-btn, ' +
        '.pv-settings-panel:not([hidden]) .pv-option');
      if (first && first.focus) first.focus();
    }

    function closeSettings() {
      if (!settings) return;
      settings.hidden = true;
      currentPanel = 'main';
      showPanel('main');
    }

    function showPanel(panel) {
      currentPanel = panel || 'main';
      var panels = settings ? settings.querySelectorAll('.pv-settings-panel') : [];
      for (var i = 0; i < panels.length; i++) {
        panels[i].hidden = panels[i].getAttribute('data-panel') !== currentPanel;
      }
      text(el('settingsTitle'), currentPanel === 'main' ? 'Settings' :
        currentPanel.charAt(0).toUpperCase() + currentPanel.slice(1));
      var back = el('settingsBack');
      show(back, currentPanel !== 'main');
    }

    function closePlayer() {
      if (options.onClose) options.onClose();
      else controller.close();
    }

    function renderQuality(s) {
      var list = el('qualityList');
      if (!list) return;
      var key = s.links.map(function (l, i) {
        return i + ':' + (l.quality || l.name || '') + ':' + l.url;
      }).join('|');
      if (key === lastLinkKey) {
        var activeButtons = list.querySelectorAll('.pv-option');
        for (var j = 0; j < activeButtons.length; j++) {
          var label = activeButtons[j].getAttribute('data-label') || '';
          var isActive = !!s.qualityLabel && label === s.qualityLabel;
          activeButtons[j].classList.toggle('active', isActive);
        }
        return;
      }
      lastLinkKey = key;
      list.innerHTML = '';
      if (!s.links.length) {
        list.innerHTML = '<div class="pv-option-empty">No quality options available</div>';
        return;
      }
      s.links.forEach(function (link, index) {
        var label = (link.quality || link.name || ('Link ' + (index + 1)));
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pv-option';
        btn.setAttribute('data-index', String(index));
        btn.setAttribute('data-label', label);
        btn.textContent = label;
        list.appendChild(btn);
      });
    }

    function renderAudio(s) {
      var row = el('audioMenuRow');
      var list = el('audioList');
      var visible = audioMenuVisible(s.audioTracks);
      show(row, visible);
      if (row) row.disabled = !visible;
      text(el('audioSummary'), visible
        ? (s.audioTracks.length + ' tracks')
        : 'Not available');

      var key = s.audioTracks.map(function (t) {
        return t.index + ':' + t.language + ':' + t.label + ':' + (t.selected ? 1 : 0);
      }).join('|');
      if (!visible || key === lastAudioKey) return;
      lastAudioKey = key;
      if (!list) return;
      list.innerHTML = '';
      s.audioTracks.forEach(function (track) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pv-option' + (track.index === s.currentAudioTrack ? ' active' : '');
        btn.setAttribute('data-index', String(track.index));
        btn.textContent = (track.label || track.language || ('Track ' + (track.index + 1)));
        if (track.language && track.language !== track.label) {
          btn.title = track.language;
        }
        list.appendChild(btn);
      });
    }

    function renderSubtitleOptions(s) {
      var toggle = el('menuSubtitleToggle');
      if (toggle) {
        var labels = {
          loading: 'Subtitles: Loading…',
          on: 'Subtitles: On',
          off: 'Subtitles: Off',
          none: 'No subtitles found'
        };
        text(toggle, labels[s.subtitleStatus] || 'Subtitles');
        toggle.setAttribute('aria-pressed', s.subtitleEnabled && s.subtitleStatus === 'on' ? 'true' : 'false');
        toggle.disabled = s.subtitleStatus === 'loading' || (!s.subtitleName && s.subtitleStatus !== 'on');
      }
      var cc = el('subtitleToggle');
      if (cc) {
        cc.setAttribute('aria-pressed', s.subtitleEnabled && s.subtitleStatus === 'on' ? 'true' : 'false');
        cc.disabled = s.subtitleStatus === 'loading' || (!s.subtitleName && s.subtitleStatus !== 'on');
      }
      text(el('subtitleSummary'),
        s.subtitleStatus === 'on' ? (s.subtitleLanguage || 'ar').toUpperCase() :
        (s.subtitleStatus === 'loading' ? 'Loading…' : s.subtitleStatus));

      var langList = el('subtitleLanguageList');
      var langKey = s.subtitleLanguages.map(function (l) { return l.code + ':' + l.label; }).join('|');
      if (langList && langKey !== lastLanguageKey) {
        lastLanguageKey = langKey;
        langList.innerHTML = '';
        if (!s.subtitleLanguages.length) {
          langList.innerHTML = '<div class="pv-option-empty">No languages reported by this provider</div>';
        } else {
          s.subtitleLanguages.forEach(function (lang) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pv-option' + (lang.code === s.subtitleLanguage ? ' active' : '');
            btn.setAttribute('data-code', lang.code);
            btn.textContent = lang.label;
            langList.appendChild(btn);
          });
        }
      }

      var providerList = el('subtitleProviderList');
      var providers = (window.Subtitles && Subtitles.providers) || [];
      var providerKey = providers.map(function (p) { return p.id; }).join('|') + ':' + s.subtitleProvider;
      if (providerList && providerKey !== lastProviderKey) {
        lastProviderKey = providerKey;
        providerList.innerHTML = '';
        providers.forEach(function (provider) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pv-option' + (provider.id === s.subtitleProvider ? ' active' : '');
          btn.setAttribute('data-id', provider.id);
          btn.textContent = provider.label;
          providerList.appendChild(btn);
        });
      }

      markOptions(el('subtitleSizeOptions'), 'size', s.subtitleSize);
      markOptions(el('subtitleBgOptions'), 'bg', s.subtitleBackground);
    }

    function markOptions(container, attr, value) {
      if (!container) return;
      var options = container.querySelectorAll('.pv-option');
      for (var i = 0; i < options.length; i++) {
        options[i].classList.toggle('active', options[i].getAttribute('data-' + attr) === value);
      }
    }

    function renderSpeed(s) {
      var list = el('speedList');
      text(el('speedSummary'), s.playbackRate + '×');
      var key = s.speeds.join('|') + ':' + s.playbackRate;
      if (!list || key === lastSpeedKey) return;
      lastSpeedKey = key;
      list.innerHTML = '';
      s.speeds.forEach(function (rate) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pv-option' + (rate === s.playbackRate ? ' active' : '');
        btn.setAttribute('data-rate', String(rate));
        btn.textContent = rate + '×';
        list.appendChild(btn);
      });
    }

    function render(s, quiet) {
      var active = modal && modal.classList.contains('active');
      if (!active) return;

      var initialLoading = s.status === 'loading' && !s.selectedUrl;
      show(el('playerStateLoading'), initialLoading);
      show(el('playerStateVideo'), !initialLoading && s.status !== 'error' && s.status !== 'idle');
      show(el('playerStateError'), s.status === 'error');
      text(el('playerErrorMsg'), s.error);
      text(el('playerTitle'), s.title);
      text(el('qualityBadge'), s.qualityDisplay || '—');
      if (el('qualityBadge')) el('qualityBadge').title = s.hint || '';

      var paused = s.status === 'paused' || s.status === 'ended' || s.status === 'idle';
      show(el('playerCenter'), !initialLoading && s.status !== 'error' && (paused || s.status === 'buffering' || s.status === 'loading'));
      show(el('centerPlayBtn'), paused && s.status !== 'error');
      show(el('playerSpinner'), s.status === 'buffering' || (!initialLoading && s.status === 'loading'));
      setIcon(el('playPauseBtn'), paused ? 'play' : 'pause');

      text(el('timeCurrent'), s.formattedCurrentTime);
      text(el('timeDuration'), s.formattedDuration || '0:00');
      var progress = s.duration > 0 ? Math.min(100, (s.currentTime / s.duration) * 100) : 0;
      var buffered = Math.min(100, s.buffered * 100);
      if (el('timelinePlayed')) el('timelinePlayed').style.width = progress + '%';
      if (el('timelineBuffered')) el('timelineBuffered').style.width = buffered + '%';
      if (el('timelineThumb')) el('timelineThumb').style.left = progress + '%';
      if (el('timeline')) {
        el('timeline').setAttribute('aria-valuemax', String(Math.round(s.duration)));
        el('timeline').setAttribute('aria-valuenow', String(Math.round(s.currentTime)));
        el('timeline').setAttribute('aria-valuetext', s.formattedCurrentTime + ' of ' + s.formattedDuration);
      }

      setIcon(el('volumeBtn'), s.muted || s.volume === 0 ? 'volume-xmark' : 'volume-up');
      if (el('volumeSlider') && document.activeElement !== el('volumeSlider')) {
        el('volumeSlider').value = String(s.muted ? 0 : s.volume);
      }
      setIcon(el('fullscreenBtn'), s.fullscreen ? 'compress' : 'expand');

      renderQuality(s);
      renderAudio(s);
      renderSubtitleOptions(s);
      renderSpeed(s);

      text(el('qualitySummary'), s.qualityDisplay);
      var remember = el('rememberQuality');
      if (remember) {
        remember.disabled = !s.qualityLabel;
        remember.setAttribute('aria-pressed', s.remembered ? 'true' : 'false');
        text(remember, 'Remember quality: ' + (s.remembered ? 'On' : 'Off'));
      }

      show(el('playerToast'), !!s.notice);
      text(el('playerToast'), s.notice);
      if (!quiet) showControls();
    }

    function timelineRatio(clientX) {
      var timeline = el('timeline');
      if (!timeline) return 0;
      var rect = timeline.getBoundingClientRect();
      if (!rect || !rect.width) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function timelineSeek(clientX) {
      var s = controller.getState();
      if (!s.duration) return;
      controller.seekTo(timelineRatio(clientX) * s.duration);
    }

    function timelinePreview(clientX) {
      var preview = el('timelinePreview');
      var s = controller.getState();
      if (!preview || !s.duration) return;
      var seconds = timelineRatio(clientX) * s.duration;
      preview.style.left = (timelineRatio(clientX) * 100) + '%';
      text(preview, PlayerController.formatTime(seconds));
      show(preview, true);
    }

    function bind() {
      click(el('playPauseBtn'), function () { controller.togglePlay(); });
      click(el('centerPlayBtn'), function () { controller.togglePlay(); });
      click(el('skipBackBtn'), function () { controller.skip(-10); });
      click(el('skipForwardBtn'), function () { controller.skip(10); });
      click(el('volumeBtn'), function () { controller.toggleMute(); });
      click(el('fullscreenBtn'), function () { controller.toggleFullscreen(); });
      click(el('playerClose'), closePlayer);
      click(el('playerErrorClose'), closePlayer);
      click(el('playerSettingsBtn'), function () {
        if (settingsOpen()) closeSettings(); else openSettings('main');
      });
      click(el('settingsClose'), closeSettings);
      click(el('settingsBack'), function () { showPanel('main'); });
      click(el('menuSubtitleToggle'), function () {
        var s = controller.getState();
        controller.setSubtitleEnabled(!s.subtitleEnabled);
      });
      click(el('subtitleToggle'), function () {
        var s = controller.getState();
        controller.setSubtitleEnabled(!s.subtitleEnabled);
      });
      click(el('rememberQuality'), function () {
        var s = controller.getState();
        controller.rememberQuality(!s.remembered);
      });

      delegate(el('qualityList'), '.pv-option[data-index]', function (node) {
        controller.selectQuality(Number(node.getAttribute('data-index')));
      });
      delegate(el('audioList'), '.pv-option[data-index]', function (node) {
        controller.setAudioTrack(Number(node.getAttribute('data-index')));
      });
      delegate(el('subtitleLanguageList'), '.pv-option[data-code]', function (node) {
        controller.setSubtitleLanguage(node.getAttribute('data-code'));
      });
      delegate(el('subtitleProviderList'), '.pv-option[data-id]', function (node) {
        controller.setSubtitleProvider(node.getAttribute('data-id'));
      });
      delegate(el('subtitleSizeOptions'), '.pv-option[data-size]', function (node) {
        controller.setSubtitleSize(node.getAttribute('data-size'));
      });
      delegate(el('subtitleBgOptions'), '.pv-option[data-bg]', function (node) {
        controller.setSubtitleBackground(node.getAttribute('data-bg'));
      });
      delegate(el('speedList'), '.pv-option[data-rate]', function (node) {
        controller.setPlaybackRate(Number(node.getAttribute('data-rate')));
      });
      delegate(el('settingsMain'), '.pv-menu-row[data-open]', function (node) {
        openSettings(node.getAttribute('data-open'));
      });

      var volume = el('volumeSlider');
      if (volume) {
        volume.addEventListener('input', function () { controller.setVolume(volume.value); });
        volume.addEventListener('change', function () { controller.setVolume(volume.value); });
      }

      var timeline = el('timeline');
      if (timeline) {
        timeline.addEventListener('mousedown', function (e) {
          scrubbing = true; timelineSeek(e.clientX); timelinePreview(e.clientX); e.preventDefault();
        });
        window.addEventListener('mouseup', function () { scrubbing = false; });
        timeline.addEventListener('mousemove', function (e) {
          timelinePreview(e.clientX);
          if (scrubbing) timelineSeek(e.clientX);
        });
        timeline.addEventListener('mouseleave', function () { show(el('timelinePreview'), false); });
        timeline.addEventListener('touchstart', function (e) {
          if (e.touches && e.touches[0]) { timelineSeek(e.touches[0].clientX); timelinePreview(e.touches[0].clientX); }
        }, { passive: true });
        timeline.addEventListener('touchmove', function (e) {
          if (e.touches && e.touches[0]) { timelineSeek(e.touches[0].clientX); timelinePreview(e.touches[0].clientX); }
        }, { passive: true });
        timeline.addEventListener('touchend', function () { show(el('timelinePreview'), false); });
        timeline.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft') { controller.skip(-10); e.preventDefault(); }
          if (e.key === 'ArrowRight') { controller.skip(10); e.preventDefault(); }
        });
      }

      if (modal) {
        modal.addEventListener('mousemove', showControls);
        modal.addEventListener('touchstart', showControls, { passive: true });
        modal.addEventListener('mousedown', showControls);
        modal.addEventListener('click', function (e) {
          if (e.target === modal) closePlayer();
        });
      }

      document.addEventListener('keydown', onKeyDown);
      controller.on('statechange', render);
      controller.on('timeupdate', function (s) {
        if (modal && modal.classList.contains('active')) render(s, true);
      });
    }

    function click(node, fn) {
      if (!node) return;
      node.addEventListener('click', function (e) { e.preventDefault(); fn(e); });
    }

    function delegate(root, selector, fn) {
      if (!root) return;
      root.addEventListener('click', function (e) {
        var node = e.target && e.target.closest ? e.target.closest(selector) : null;
        if (node && root.contains(node)) {
          e.preventDefault();
          fn(node, e);
        }
      });
    }

    function visibleFocusables() {
      if (!settings) return [];
      var panel = settings.querySelector('.pv-settings-panel:not([hidden])');
      if (!panel) return [];
      return Array.prototype.slice.call(panel.querySelectorAll('button:not([hidden]):not([disabled])'));
    }

    function navigateMenu(direction) {
      var items = visibleFocusables();
      if (!items.length) return false;
      var index = items.indexOf(document.activeElement);
      var next = index < 0 ? 0 : (index + direction + items.length) % items.length;
      items[next].focus();
      return true;
    }

    function isTextField(node) {
      if (!node) return false;
      var tag = String(node.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node.isContentEditable;
    }

    function onKeyDown(e) {
      if (!modal || !modal.classList.contains('active') || isTextField(e.target)) return;
      // Tizen/Smart TV Back key behaves like Escape.
      if (e.keyCode === 10009) e.key = 'Escape';
      if (settingsOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        navigateMenu(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault(); controller.togglePlay(); break;
        case 'ArrowLeft':
          e.preventDefault(); controller.skip(-10); break;
        case 'ArrowRight':
          e.preventDefault(); controller.skip(10); break;
        case 'ArrowUp':
          e.preventDefault(); controller.setVolume(controller.getState().volume + 0.1); break;
        case 'ArrowDown':
          e.preventDefault(); controller.setVolume(controller.getState().volume - 0.1); break;
        case 'm':
        case 'M':
          e.preventDefault(); controller.toggleMute(); break;
        case 'f':
        case 'F':
          e.preventDefault(); controller.toggleFullscreen(); break;
        case 'Escape':
          e.preventDefault();
          if (settingsOpen()) closeSettings();
          else if (controller.getState().fullscreen) controller.toggleFullscreen();
          else closePlayer();
          break;
        default:
          break;
      }
      showControls();
    }

    bind();

    return {
      open: open,
      close: close,
      render: function () { render(controller.getState()); },
      openSettings: openSettings,
      closeSettings: closeSettings,
      showControls: showControls,
      destroy: function () {
        if (hideTimer) clearTimeout(hideTimer);
        document.removeEventListener('keydown', onKeyDown);
      }
    };
  }

  return { create: create, audioMenuVisible: audioMenuVisible };
})();
