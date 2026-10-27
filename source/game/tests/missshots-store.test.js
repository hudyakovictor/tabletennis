/* The host store also reads the earlier branch's localStorage gallery. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../../src/services/miss_shots.js');
function store(initial = [], failWrites = false) {
  const data = new Map([['ttu-miss-shots', JSON.stringify(initial)]]);
  const storage = { getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (failWrites) throw new Error('quota'); data.set(k, v); },
    removeItem: k => { if (failWrites) throw new Error('blocked'); data.delete(k); } };
  const ctx = vm.createContext({ localStorage: storage, ZoneStats: { all: () => [] } });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;globalThis.store = MissShots;', ctx);
  return { shots: ctx.store, data };
}

test('legacy screenshots stay readable; a new id cannot overwrite a numeric legacy id', () => {
  const { shots, data } = store([{ id: 1, t: 1, img: 'T0xE', kind: 'rally', accepted: false }]);
  assert.equal(shots.all().length, 1);
  shots.add({ id: 'new-instance-1', t: 2, img: 'TkVX', status: 'pending' });
  shots.result('new-instance-1', { contact: false, reason: 'TIMING_LATE' });
  assert.equal(shots.all().length, 2); assert.equal(shots.get(1).img, 'T0xE');
  assert.equal(shots.get('new-instance-1').reason, 'TIMING_LATE');
  shots.result('new-instance-1', { contact: true });
  assert.equal(shots.all().length, 1); assert.equal(JSON.parse(data.get(shots.KEY))[0].id, 1);
});

test('a quota or storage denial keeps new screenshots in memory and reports it', () => {
  const { shots } = store([{ id: 1, img: 'T0xE' }], true);
  shots.add({ id: 'new', img: 'TkVX' });
  assert.equal(shots.storage, 'memory'); assert.match(shots.error, /quota/);
  assert.equal(shots.all().length, 2); assert.ok(shots.get('new'));
  shots.drop('new'); assert.equal(shots.all().length, 1);
  assert.equal(shots.clear(), false); assert.equal(shots.all().length, 0);
  assert.equal(shots.storage, 'memory');
});

test('gallery is bounded and rejects malformed image data', () => {
  const { shots } = store();
  for (let i = 0; i < 43; i++) shots.add({ id: `i-${i}`, img: 'RkFLRQ==' });
  assert.equal(shots.all().length, 40); assert.equal(shots.get('i-0'), null);
  assert.equal(shots.add({ id: 'bad', img: '\"><img onerror=alert(1)>' }), false);
  assert.equal(shots.all().length, 40);
});
