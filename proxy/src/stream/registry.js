'use strict';

var active = new Set();

function register(destroy) {
  if (typeof destroy !== 'function') return function () {};
  var entry = {
    destroy: destroy,
    release: function () { active.delete(entry); }
  };
  active.add(entry);
  var released = false;
  return function release() {
    if (released) return;
    released = true;
    active.delete(entry);
  };
}

function destroyAll() {
  active.forEach(function (entry) {
    try { entry.destroy(); } catch (e) {}
  });
}

function count() { return active.size; }

module.exports = { register, destroyAll, count };
