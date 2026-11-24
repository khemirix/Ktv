'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createIdleGuard } = require('../src/stream/idle-timeout');

test('idle timer resets on data and survives a continuous stream beyond 60 seconds', () => {
  test.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const upstream = new EventEmitter();
    let timedOut = false;
    const guard = createIdleGuard(upstream, 60000, function () { timedOut = true; });

    // Watch data arrival the way the forwarder does, then simulate 70 seconds
    // of continuous playback with a chunk every 10 seconds.
    guard.watchData();
    for (let second = 10; second <= 70; second += 10) {
      test.mock.timers.tick(10000);
      upstream.emit('data', Buffer.from([0x47]));
    }
    assert.equal(timedOut, false, 'continuous data must keep the stream alive');

    test.mock.timers.tick(60000);
    assert.equal(timedOut, true, 'a genuinely stalled stream must time out');
    guard.dispose();
    assert.equal(upstream.listenerCount('data'), 0);
    assert.equal(upstream.listenerCount('close'), 0);
  } finally {
    test.mock.timers.reset();
  }
});
