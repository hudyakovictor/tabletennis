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

test('a contact reported before its deferred JPEG never creates a phantom miss', () => {
  const { shots, data } = store([{ id: 'other', img: 'T0xE', status: 'miss' }]);
  assert.equal(shots.result('tap', { contact: true }), true);
  assert.equal(shots.add({ id: 'tap', img: 'RkFLRQ==', status: 'pending' }), true);
  assert.equal(shots.get('tap'), null);
  assert.equal(shots.all().length, 1);
  assert.equal(JSON.parse(data.get(shots.KEY))[0].id, 'other');
});

test('an early miss is merged into the first image and survives duplicate messages', () => {
  const { shots } = store();
  shots.result('miss', { contact: false, reason: 'TIMING_EARLY' });
  shots.add({ id: 'miss', img: 'T0xE', status: 'pending', reason: null });
  assert.equal(shots.get('miss').status, 'miss');
  assert.equal(shots.get('miss').reason, 'TIMING_EARLY');
  shots.result('miss', { contact: false, reason: 'TIMING_LATE' });
  shots.add({ id: 'miss', img: 'TkVX', status: 'pending', reason: null });
  assert.equal(shots.all().length, 1);
  assert.equal(shots.get('miss').img, 'T0xE', 'a duplicate cannot replace the first captured frame');
  assert.equal(shots.get('miss').reason, 'TIMING_EARLY', 'retain the first observed miss reason');
});

test('early drops and completed contacts remain tombstones for duplicate or stale misses', () => {
  const { shots } = store();
  for (const imageFirst of [false, true]) {
    const id = 'drop-' + imageFirst, image = { id, img: 'RkFLRQ==', status: 'pending' };
    if (imageFirst) shots.add(image);
    assert.equal(shots.drop(id), true);
    shots.result(id, { contact: false, reason: 'POINT_LOST' });
    shots.add(image); shots.add(image);
    assert.equal(shots.get(id), null, 'a terminal drop/contact cannot be downgraded by a late miss or JPEG');
  }
});

test('contact supersedes an early miss without allowing a later image to resurrect it', () => {
  const { shots } = store();
  shots.result('hit', { contact: false, reason: 'TIMING_EARLY' });
  shots.result('hit', { contact: true });
  shots.add({ id: 'hit', img: 'RkFLRQ==', status: 'pending' });
  assert.equal(shots.get('hit'), null);
});

test('outcome buffering stays bounded even when captures never arrive', () => {
  const { shots } = store();
  for (let i = 0; i < 1000; i++) shots.result('uncaptured-' + i, { contact: i % 2 === 0, reason: 'TIMING_EARLY' });
  assert.ok(shots.outcomes.size <= shots.MAX_OUTCOMES);
  assert.equal(shots.all().length, 0);
  shots.add({ id: 'uncaptured-999', img: 'RkFLRQ==', status: 'pending' });
  assert.equal(shots.get('uncaptured-999').status, 'miss');
});

test('clearing the gallery discards queued old frames but allows new captures', () => {
  const { shots } = store();
  const staleTime = Date.now() - 1000;
  shots.add({ id: 'old', t: staleTime, img: 'T0xE' });
  shots.result('waiting', { contact: false, reason: 'TIMING_EARLY' });
  shots.clear();
  shots.add({ id: 'old', t: staleTime, img: 'T0xE' });
  shots.add({ id: 'waiting', t: staleTime, img: 'RkFLRQ==' });
  shots.add({ id: 'unseen-old', t: staleTime, img: 'RkFLRQ==' });
  assert.equal(shots.all().length, 0);
  shots.add({ id: 'new', t: Date.now() + 1, img: 'TkVX', status: 'pending' });
  assert.equal(shots.all().length, 1);
  assert.equal(shots.get('new').status, 'pending');
});
