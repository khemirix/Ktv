'use strict';

function parsePlaylist(text) {
  var lines = String(text || '').split(/\r?\n/);
  var first = (lines[0] || '').replace(/^\uFEFF/, '').trim();
  var isPlaylist = /^#EXTM3U/.test(first);
  var isMaster = lines.some(function (line) { return /^#EXT-X-STREAM-INF:/.test(line); });
  var isMedia = !isMaster && lines.some(function (line) {
    return /^#EXTINF:/.test(line) || /^#EXT-X-TARGETDURATION:/.test(line);
  });
  var hasEndList = lines.some(function (line) { return /^#EXT-X-ENDLIST/.test(line); });
  var hasEncryption = lines.some(function (line) { return /^#EXT-X-KEY:/.test(line); });
  var hasMap = lines.some(function (line) { return /^#EXT-X-MAP:/.test(line); });
  var uriCount = lines.filter(function (line) {
    var trimmed = line.trim();
    return trimmed && trimmed.charAt(0) !== '#';
  }).length;

  return {
    isPlaylist: isPlaylist,
    isMaster: isMaster,
    isMedia: isMedia,
    hasEndList: hasEndList,
    hasEncryption: hasEncryption,
    hasMap: hasMap,
    uriCount: uriCount
  };
}

module.exports = { parsePlaylist };
