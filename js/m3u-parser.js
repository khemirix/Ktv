/* Robust M3U/M3U8 parser for Khemirix TV.
 *
 * The parser is deliberately incremental: a worker feeds it text chunks and it
 * emits one channel per URL line. It never keeps the whole playlist in memory.
 * Attribute values may contain commas, quotes, Unicode, and IPTV-specific keys.
 */
var M3UParser = (function () {
  function decodeEntities(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  // Finds the comma that separates EXTINF attributes from the display name,
  // ignoring commas inside quoted attribute values.
  function lastCommaOutsideQuotes(input) {
    var text = String(input || '');
    var quoted = false;
    var escaped = false;
    var found = -1;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) found = i;
    }
    return found;
  }

  // Parses tvg-id="...",tvg-name="...",group-title="..." without splitting
  // values that contain commas or escaped quotes.
  function parseAttributes(input) {
    var text = String(input || '');
    var attrs = {};
    var i = 0;

    while (i < text.length) {
      while (i < text.length && /[\s,]/.test(text.charAt(i))) i++;
      if (i >= text.length) break;

      var keyStart = i;
      while (i < text.length && text.charAt(i) !== '=' && text.charAt(i) !== ',') i++;
      // EXTINF starts with a duration ("-1 tvg-id=..."). Keep only the final
      // whitespace-separated token as the attribute name.
      var key = text.slice(keyStart, i).trim().split(/\s+/).pop() || '';
      if (i >= text.length || text.charAt(i) !== '=' || !key) {
        while (i < text.length && text.charAt(i) !== ',') i++;
        continue;
      }
      i++; // skip '='
      while (i < text.length && /\s/.test(text.charAt(i))) i++;

      var value = '';
      if (text.charAt(i) === '"') {
        i++;
        var escaped = false;
        while (i < text.length) {
          var ch = text.charAt(i);
          if (escaped) { value += ch; escaped = false; i++; continue; }
          if (ch === '\\') { escaped = true; i++; continue; }
          if (ch === '"') { i++; break; }
          value += ch;
          i++;
        }
      } else {
        var start = i;
        while (i < text.length && text.charAt(i) !== ',') i++;
        value = text.slice(start, i).trim();
      }
      var upper = key.toUpperCase();
      attrs[upper] = decodeEntities(value);
      // Canonical aliases let callers use TVGID / GROUPTITLE as well as the
      // literal hyphenated attribute names from the playlist.
      attrs[upper.replace(/[-_]/g, '')] = attrs[upper];
    }
    return attrs;
  }

  function isAbsoluteUrl(value) {
    var text = String(value || '');
    return /^[a-z][a-z0-9+.-]*:/i.test(text) || text.indexOf('//') === 0;
  }

  function resolveUrl(ref, baseUrl) {
    var text = decodeEntities(String(ref || '').trim());
    if (!text) return '';
    if (isAbsoluteUrl(text)) return text;
    if (!baseUrl) return text;
    try {
      return new URL(text, baseUrl).href;
    } catch (e) {
      return text;
    }
  }

  function blankChannel() {
    return {
      id: '',
      name: '',
      category: '',
      group: '',
      logo: '',
      stream: '',
      mime: '',
      headers: {},
      rawInfo: ''
    };
  }

  function parseExtinf(line) {
    var rest = String(line || '').slice(line.indexOf(':') + 1);
    var comma = lastCommaOutsideQuotes(rest);
    var attrPart = comma >= 0 ? rest.slice(0, comma) : rest;
    var name = comma >= 0 ? rest.slice(comma + 1) : '';
    var attrs = parseAttributes(attrPart);
    return {
      attrs: attrs,
      name: decodeEntities(name.trim()) || attrs.TVGNAME || attrs.TVGID || '',
      id: attrs.TVGID || '',
      logo: attrs.TVGLOGO || '',
      category: attrs.GROUPTITLE || ''
    };
  }

  // Returns a parser that can be fed arbitrary text chunks. `emit` is called
  // once per usable channel; `done` is called after end().
  function createStreamingParser(baseUrl, emit, done) {
    var buffer = '';
    var pending = blankChannel();
    var hasPendingInfo = false;
    var count = 0;

    function commit() {
      if (!pending.stream) return;
      var channel = {
        id: pending.id,
        name: pending.name,
        category: pending.category || pending.group || 'Uncategorized',
        group: pending.group,
        logo: pending.logo,
        stream: pending.stream,
        mime: pending.mime || '',
        headers: pending.headers || {}
      };
      count += 1;
      if (typeof emit === 'function') {
        try { emit(channel); } catch (e) { /* consumer errors never stop parsing */ }
      }
      pending = blankChannel();
      hasPendingInfo = false;
    }

    function processLine(rawLine) {
      var line = String(rawLine || '').replace(/^\uFEFF/, '').replace(/\r$/, '').trim();
      if (!line) return;
      if (/^#EXTM3U\b/i.test(line)) return;

      if (/^#EXTINF:/i.test(line)) {
        if (pending.stream) commit();
        var info = parseExtinf(line);
        pending.id = info.id;
        pending.name = info.name;
        pending.logo = info.logo;
        pending.category = info.category;
        pending.rawInfo = line;
        hasPendingInfo = true;
        return;
      }

      if (/^#EXTGRP:/i.test(line)) {
        pending.group = decodeEntities(line.slice(line.indexOf(':') + 1).trim());
        pending.category = pending.category || pending.group;
        hasPendingInfo = true;
        return;
      }

      // KODIPROP / EXTVLCOPT can carry MIME and request headers. Other
      // comments (including EXT-X-*) are intentionally ignored.
      if (/^#(KODIPROP|EXTVLCOPT):/i.test(line)) {
        var option = line.slice(line.indexOf(':') + 1);
        var eq = option.indexOf('=');
        if (eq > 0) {
          var optKey = option.slice(0, eq).trim().toLowerCase();
          var optValue = decodeEntities(option.slice(eq + 1).trim());
          if (optValue.charAt(0) === '"' && optValue.charAt(optValue.length - 1) === '"') {
            optValue = optValue.slice(1, -1);
          }
          if (optKey === 'mimetype' || optKey === 'type' || optKey === 'content-type') {
            pending.mime = optValue;
          } else if (optKey === 'http-user-agent') {
            pending.headers['User-Agent'] = optValue;
          } else if (optKey === 'http-referrer' || optKey === 'referer') {
            pending.headers.Referer = optValue;
          } else if (optKey === 'http-origin') {
            pending.headers.Origin = optValue;
          } else if (optKey === 'http-header') {
            var colon = optValue.indexOf(':');
            if (colon > 0) {
              pending.headers[optValue.slice(0, colon).trim()] = optValue.slice(colon + 1).trim();
            }
          }
        }
        return;
      }
      if (line.charAt(0) === '#') return;

      var stream = resolveUrl(line, baseUrl);
      if (!stream) return;
      // A bare URL line is valid M3U even without EXTINF.
      pending.stream = stream;
      pending.name = pending.name || stream.split('/').pop() || ('Channel ' + (count + 1));
      commit();
    }

    function push(chunk) {
      if (chunk === null || chunk === undefined) return;
      var text = '';
      if (typeof chunk === 'string') text = chunk;
      else if (typeof TextDecoder !== 'undefined' && (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk))) {
        text = new TextDecoder('utf-8').decode(chunk);
      } else {
        text = String(chunk);
      }
      buffer += text;
      var index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        processLine(line);
      }
    }

    function end() {
      if (buffer.trim()) processLine(buffer);
      buffer = '';
      commit();
      if (typeof done === 'function') done(count);
    }

    return { push: push, end: end, count: function () { return count; } };
  }

  function parseText(text, baseUrl) {
    var channels = [];
    var parser = createStreamingParser(baseUrl || '', function (channel) {
      channels.push(channel);
    });
    parser.push(text || '');
    parser.end();
    return channels;
  }

  // Loads a local File or remote playlist URL in a Web Worker. The caller
  // receives channels one by one and is responsible for storing/rendering them.
  function load(source, options) {
    options = options || {};
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Web Workers are unavailable in this browser'));
    }

    var workerUrl;
    try {
      workerUrl = new URL('js/m3u-worker.js', document.baseURI || window.location.href).href;
    } catch (e) {
      workerUrl = 'js/m3u-worker.js';
    }

    var worker;
    try {
      worker = new Worker(workerUrl);
    } catch (e) {
      return Promise.reject(new Error('Playlist worker could not be started'));
    }
    var reader = null;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, options.timeout || 30000) : null;
    var count = 0;

    worker.onmessage = function (event) {
      var data = event.data || {};
      if (data.type === 'channel' && typeof options.onChannel === 'function') {
        count += 1;
        options.onChannel(data.channel);
      } else if (data.type === 'progress' && typeof options.onProgress === 'function') {
        options.onProgress(data.count);
      } else if (data.type === 'done') {
        finish(null, data.count);
      } else if (data.type === 'error') {
        finish(new Error(data.message || 'Playlist could not be parsed'));
      }
    };
    worker.onerror = function (event) {
      finish(new Error((event && event.message) || 'Playlist worker failed'));
    };

    function finish(error, finalCount) {
      if (timer) clearTimeout(timer);
      timer = null;
      try { worker.terminate(); } catch (e) {}
      if (reader && reader.cancel) {
        try { reader.cancel(); } catch (e) {}
        reader = null;
      }
      if (error) {
        if (options.reject) options.reject(error);
      } else if (options.resolve) {
        options.resolve({ count: finalCount || count });
      }
    }

    worker.postMessage({ type: 'start', baseUrl: options.baseUrl || '' });

    function feedStream(stream) {
      reader = stream.getReader();
      var decoder = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            worker.postMessage({ type: 'end' });
            return;
          }
          worker.postMessage({
            type: 'chunk',
            text: decoder ? decoder.decode(result.value, { stream: true }) : String(result.value)
          });
          return pump();
        });
      }
      pump().catch(function (err) { finish(err); });
    }

    var sourcePromise;
    if (source && typeof source.stream === 'function') {
      sourcePromise = Promise.resolve(source);
    } else if (typeof source === 'string') {
      var headers = options.headers || {};
      sourcePromise = fetch(source, {
        headers: headers,
        signal: controller ? controller.signal : undefined,
        credentials: options.credentials || 'same-origin',
        redirect: 'follow'
      }).then(function (res) {
        if (!res.ok) throw new Error('Playlist request failed with HTTP ' + res.status);
        return res.body || res.text();
      });
    } else if (source && typeof source.text === 'function') {
      sourcePromise = source.text().then(function (text) { return text; });
    } else {
      sourcePromise = Promise.resolve(String(source || ''));
    }

    sourcePromise.then(function (data) {
      if (data && typeof data.getReader === 'function') {
        feedStream(data);
      } else {
        worker.postMessage({ type: 'chunk', text: String(data || '') });
        worker.postMessage({ type: 'end' });
      }
    }).catch(function (err) {
      finish(err);
    });

    return new Promise(function (resolve, reject) {
      options.resolve = resolve;
      options.reject = reject;
    });
  }

  return {
    parseText: parseText,
    parseAttributes: parseAttributes,
    resolveUrl: resolveUrl,
    createStreamingParser: createStreamingParser,
    load: load
  };
})();
