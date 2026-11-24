'use strict';

function createRateLimiter(options) {
  options = options || {};
  var windowMs = options.windowMs || 60000;
  var max = options.max || 120;
  var buckets = new Map();
  var lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    buckets.forEach(function (bucket, key) {
      if (bucket.resetAt <= now) buckets.delete(key);
    });
  }

  return function check(key) {
    var now = Date.now();
    sweep(now);
    var bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= max,
      remaining: Math.max(0, max - bucket.count),
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
    };
  };
}

module.exports = { createRateLimiter };
