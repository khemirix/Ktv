'use strict';

function createConnectionLimit(max) {
  var active = 0;
  var limit = max > 0 ? max : 100;

  return {
    acquire: function () {
      if (active >= limit) return false;
      active += 1;
      return true;
    },
    release: function () {
      active = Math.max(0, active - 1);
    },
    count: function () { return active; },
    limit: function () { return limit; }
  };
}

module.exports = { createConnectionLimit };
