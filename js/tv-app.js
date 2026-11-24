/* Live TV page controller for Khemirix TV.
 *
 * Keeps the original channels.json catalogue, adds worker-based M3U loading,
 * batched DOM rendering for very large playlists, and delegates playback to
 * LiveStreamPlayer. Stream URLs and tokens are never written to logs.
 */
(function () {
  var PROXY = 'https://t-ahg3.onrender.com';
  var PLACEHOLDER = 'https://placehold.co/320x180/111/444?text=TV';
  var baseChannels = [];
  var playlistChannels = [];
  var channels = [];
  var displayedList = [];
  var activeCategory = 'All';
  var livePlayer = null;
  var playerModal = null;
  var renderToken = 0;

  function byId(id) { return document.getElementById(id); }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setPlaylistStatus(message, isError) {
    var el = byId('playlistStatus');
    el.textContent = message;
    el.classList.toggle('error', !!isError);
  }

  function keyFor(channel) {
    return String(channel.stream || '') + '|' + String(channel.name || '');
  }

  function buildCategories() {
    var container = byId('categoryFilters');
    var cats = ['All'];
    channels.forEach(function (c) {
      var cat = c.category || 'Uncategorized';
      if (cats.indexOf(cat) === -1) cats.push(cat);
    });
    container.textContent = '';
    cats.forEach(function (cat) {
      var btn = make('button', 'cat-btn' + (cat === activeCategory ? ' active' : ''), cat);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        activeCategory = cat;
        Array.prototype.forEach.call(container.querySelectorAll('.cat-btn'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        applyFilters();
      });
      container.appendChild(btn);
    });
  }

  function applyFilters() {
    var query = byId('searchInput').value.toLowerCase().trim();
    var base = activeCategory === 'All'
      ? channels
      : channels.filter(function (c) { return (c.category || 'Uncategorized') === activeCategory; });
    var filtered = query
      ? base.filter(function (c) {
          return String(c.name || '').toLowerCase().indexOf(query) !== -1;
        })
      : base;
    renderChannels(filtered);
  }

  function renderChannels(list) {
    var grid = byId('channelsGrid');
    var token = ++renderToken;
    displayedList = list;
    grid.textContent = '';

    if (!list.length) {
      grid.appendChild(make('div', 'no-channels col-12', 'No channels found.'));
      return;
    }

    var index = 0;
    var batchSize = 120;
    function appendBatch() {
      if (token !== renderToken) return;
      var fragment = document.createDocumentFragment();
      var end = Math.min(index + batchSize, list.length);
      for (; index < end; index++) {
        var ch = list[index];
        var col = make('div', 'col-6 col-sm-4 col-md-3 col-lg-2');
        var card = make('div', 'channel-card');
        card.dataset.index = index;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Play ' + (ch.name || 'channel'));

        var poster = make('div', 'channel-poster');
        var img = make('img');
        img.src = ch.logo || PLACEHOLDER;
        img.alt = ch.name || '';
        img.loading = 'lazy';
        img.onerror = function () {
          this.onerror = null;
          this.src = PLACEHOLDER;
        };
        poster.appendChild(img);
        poster.appendChild(make('div', 'card-play-overlay'));
        poster.querySelector('.card-play-overlay').appendChild(make('i', 'fas fa-play'));
        poster.appendChild(make('span', 'card-live-tag', 'LIVE'));

        var info = make('div', 'channel-info');
        info.appendChild(make('div', 'channel-name', ch.name || 'Unnamed channel'));
        info.appendChild(make('div', 'channel-cat', ch.category || 'Uncategorized'));
        card.appendChild(poster);
        card.appendChild(info);
        col.appendChild(card);
        fragment.appendChild(col);
      }
      grid.appendChild(fragment);
      if (index < list.length) requestAnimationFrame(appendBatch);
    }
    requestAnimationFrame(appendBatch);
  }

  function setStatus(state) {
    var el = byId('playerStatus');
    el.className = 'player-status ' + state + ' ms-2';
    var labels = { loading: 'LOADING', playing: 'LIVE', error: 'ERROR', idle: 'IDLE' };
    el.textContent = labels[state] || String(state || '').toUpperCase();
  }

  function showLoader(show, msg) {
    var el = byId('videoLoader');
    if (!show) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (msg) byId('loaderText').textContent = msg;
  }

  function populateSelect(select, tracks, includeOff, selectedIndex) {
    select.textContent = '';
    if (includeOff) {
      var off = make('option', '', 'Off');
      off.value = '-1';
      select.appendChild(off);
    }
    tracks.forEach(function (track) {
      var option = make('option', '', track.label + (track.language ? ' (' + track.language + ')' : ''));
      option.value = String(track.index);
      select.appendChild(option);
    });
    if (selectedIndex !== undefined && selectedIndex !== null && selectedIndex >= 0) {
      select.value = String(selectedIndex);
    }
  }

  function renderTracks(tracks) {
    tracks = tracks || {};
    var audio = tracks.audio || [];
    var subtitles = tracks.subtitles || [];
    var audioWrap = byId('audioTrackWrap');
    var subWrap = byId('subtitleTrackWrap');
    var bar = byId('trackBar');

    // Audio choices are only useful when there is a real alternative.
    audioWrap.hidden = audio.length < 2;
    // Subtitle choices appear only when a real subtitle track exists.
    subWrap.hidden = subtitles.length === 0;
    bar.hidden = audioWrap.hidden && subWrap.hidden;

    if (!audioWrap.hidden) {
      var currentAudio = audio.filter(function (t) { return t.selected; })[0];
      populateSelect(byId('audioTrackSelect'), audio, false, currentAudio ? currentAudio.index : 0);
    }
    if (!subWrap.hidden) {
      var currentSub = subtitles.filter(function (t) { return t.selected; })[0];
      populateSelect(byId('subtitleTrackSelect'), subtitles, true, currentSub ? currentSub.index : -1);
    }
  }

  function stopStream() {
    if (livePlayer) livePlayer.stop();
    renderTracks({ audio: [], subtitles: [] });
  }

  function playStream(ch) {
    if (!ch || !ch.stream) {
      setStatus('error');
      showLoader(true, 'This channel has no stream URL.');
      return;
    }
    var proxyUrl = PROXY + '/fetch?url=' + encodeURIComponent(ch.stream);
    livePlayer.play(proxyUrl, {
      name: ch.name || 'stream',
      label: ch.name || 'stream',
      mime: ch.mime || ch.contentType || ch.type || '',
      kind: ch.kind || '',
      headers: ch.headers || {},
      credentials: 'omit',
      live: true,
      timeout: 12000
    });
  }

  function openChannel(index) {
    var ch = displayedList[index];
    if (!ch) return;
    byId('modalLogo').src = ch.logo || PLACEHOLDER;
    byId('modalLogo').onerror = function () {
      this.onerror = null;
      this.src = PLACEHOLDER;
    };
    byId('modalName').textContent = ch.name || 'Channel';
    setStatus('loading');
    showLoader(true, 'Connecting to ' + (ch.name || 'stream') + '…');
    playerModal.show();
    playStream(ch);
  }

  function loadPlaylist(source, baseUrl, label) {
    if (!window.M3UParser || !M3UParser.load) {
      setPlaylistStatus('Playlist parser is unavailable on this page.', true);
      return;
    }
    setPlaylistStatus('Parsing ' + label + ' in the background…');
    var pending = [];
    M3UParser.load(source, {
      baseUrl: baseUrl || '',
      timeout: 60000,
      onChannel: function (channel) {
        pending.push(channel);
        if (pending.length % 500 === 0) {
          setPlaylistStatus('Parsed ' + pending.length + ' entries from ' + label + '…');
        }
      }
    }).then(function (result) {
      var known = {};
      baseChannels.concat(playlistChannels).forEach(function (ch) { known[keyFor(ch)] = true; });
      pending.forEach(function (ch) {
        var key = keyFor(ch);
        if (!key || known[key]) return;
        known[key] = true;
        playlistChannels.push(ch);
      });
      channels = baseChannels.concat(playlistChannels);
      activeCategory = 'All';
      buildCategories();
      applyFilters();
      setPlaylistStatus('Loaded ' + result.count + ' entries from ' + label + '. ' +
        channels.length + ' channels are now available.');
    }).catch(function (err) {
      setPlaylistStatus('Could not load ' + label + ': ' + ((err && err.message) || 'unknown error'), true);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    playerModal = new bootstrap.Modal(byId('tvPlayerModal'));
    livePlayer = LiveStreamPlayer.create({
      video: byId('tvVideo'),
      onStatus: function (state, message) {
        setStatus(state === 'playing' ? 'playing' : 'loading');
        if (state === 'playing') showLoader(false);
        else showLoader(true, message || 'Connecting…');
      },
      onError: function (message) {
        setStatus('error');
        showLoader(true, message || 'Stream error. Try another channel.');
      },
      onTracks: renderTracks
    });

    byId('tvPlayerModal').addEventListener('hidden.bs.modal', stopStream);
    byId('channelsGrid').addEventListener('click', function (event) {
      var card = event.target.closest('.channel-card');
      if (card) openChannel(Number(card.dataset.index));
    });
    byId('channelsGrid').addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var card = event.target.closest('.channel-card');
      if (!card) return;
      event.preventDefault();
      openChannel(Number(card.dataset.index));
    });

    byId('searchInput').addEventListener('input', applyFilters);
    byId('audioTrackSelect').addEventListener('change', function () {
      if (livePlayer) livePlayer.setAudioTrack(Number(this.value));
    });
    byId('subtitleTrackSelect').addEventListener('change', function () {
      if (livePlayer) livePlayer.setSubtitleTrack(Number(this.value));
    });

    byId('loadPlaylistUrl').addEventListener('click', function () {
      var url = byId('playlistUrl').value.trim();
      if (!url) {
        setPlaylistStatus('Enter a playlist URL first.', true);
        return;
      }
      loadPlaylist(url, url, 'playlist URL');
    });
    byId('playlistUrl').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') byId('loadPlaylistUrl').click();
    });
    byId('loadPlaylistFile').addEventListener('click', function () {
      var file = byId('playlistFile').files && byId('playlistFile').files[0];
      if (!file) {
        setPlaylistStatus('Choose a local .m3u or .m3u8 file first.', true);
        return;
      }
      loadPlaylist(file, '', file.name);
    });

    fetch('channels.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        baseChannels = Array.isArray(data) ? data : [];
        channels = baseChannels.slice();
        buildCategories();
        applyFilters();
      })
      .catch(function () {
        byId('channelsGrid').appendChild(make('div', 'no-channels col-12', 'Could not load channels.json'));
      });
  });
})();
