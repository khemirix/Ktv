'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { pinnedLookup } = require('../src/stream/upstream');

function invoke(target, dnsOptions) {
  return new Promise(function (resolve) {
    pinnedLookup(target)('example.test', dnsOptions, function (err, value) {
      resolve({ err: err, value: value });
    });
  });
}

test('pinned lookup supports Node all:true and single-address callbacks', async () => {
  const target = { address: '93.184.216.34', family: 4 };

  let result = await invoke(target, { all: true, family: undefined, hints: 32 });
  assert.equal(result.err, null);
  assert.deepEqual(result.value, [{ address: '93.184.216.34', family: 4 }]);

  result = await invoke(target, { all: false });
  assert.equal(result.err, null);
  assert.equal(result.value, '93.184.216.34');

  result = await invoke({ address: '2606:4700::1111', family: 6 }, { all: true });
  assert.deepEqual(result.value, [{ address: '2606:4700::1111', family: 6 }]);
});
