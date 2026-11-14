import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandoff, HANDOFF_FAILED_KEY, HANDOFF_ID_KEY, HANDOFF_MAX_AGE_MS} from '../../src/tool/photo-handoff.js';

const memorySession = () => {
  const map = new Map();
  return {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key), map};
};
const memoryStore = () => {
  const records = new Map();
  return {
    records,
    async put(record) { records.set(record.id, record); },
    async take(id) { const record = records.get(id) ?? null; records.delete(id); return record; },
    async sweep(olderThan) { for (const [id, record] of records) if (!(record.createdAt > olderThan)) records.delete(id); },
  };
};
const photo = (name = 'cat.jpg') => new File([new Uint8Array([1, 2, 3])], name, {type: 'image/jpeg', lastModified: 5});

test('a saved photo arrives once, with its settings, in the same tab', async () => {
  const session = memorySession(), store = memoryStore();
  let clock = 1000;
  const handoff = createHandoff({store, session, now: () => clock, id: () => 'a'});
  assert.equal(await handoff.save({file: photo(), settings: {mode: 'restore', restore: {mode: 'colorization'}}}), true);
  assert.equal(session.getItem(HANDOFF_ID_KEY), 'a');
  clock += 1000;
  const arrived = await handoff.take();
  assert.equal(arrived.file.name, 'cat.jpg');
  assert.equal(arrived.file.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await arrived.file.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(arrived.settings, {mode: 'restore', restore: {mode: 'colorization'}});
  // Taken once: a reload or a second take finds nothing.
  assert.equal(await handoff.take(), null);
  assert.equal(store.records.size, 0);
});

test('another tab, with its own sessionStorage, does not see the photo', async () => {
  const store = memoryStore();
  const first = createHandoff({store, session: memorySession(), id: () => 'a'});
  const second = createHandoff({store, session: memorySession(), id: () => 'b'});
  await first.save({file: photo()});
  assert.equal(await second.take(), null);
  assert.equal(store.records.has('a'), true);
});

test('a failed write sets a flag the next page reports, and nothing is left behind', async () => {
  const session = memorySession();
  const store = {...memoryStore(), async put() { throw new Error('QuotaExceededError'); }};
  const handoff = createHandoff({store, session});
  assert.equal(await handoff.save({file: photo()}), false);
  assert.equal(session.getItem(HANDOFF_FAILED_KEY), '1');
  assert.equal(session.getItem(HANDOFF_ID_KEY), null);
  assert.deepEqual(await handoff.take(), {failed: true});
  assert.equal(await handoff.take(), null);
});

test('no IndexedDB or sessionStorage counts as a failed handoff, not a crash', async () => {
  const throwing = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); }};
  const handoff = createHandoff({store: memoryStore(), session: throwing});
  assert.equal(await handoff.save({file: photo()}), false);
  assert.equal(await handoff.take(), null);
});

test('an expired record is refused and swept; strangers\' old records are swept too', async () => {
  const session = memorySession(), store = memoryStore();
  let clock = 0;
  const handoff = createHandoff({store, session, now: () => clock, id: () => 'mine'});
  await store.put({id: 'stale', createdAt: 0});
  await handoff.save({file: photo()});
  clock = HANDOFF_MAX_AGE_MS + 1;
  assert.deepEqual(await handoff.take(), {failed: true});
  assert.equal(store.records.size, 0);
});

test('a record that vanished counts as failed', async () => {
  const session = memorySession(), store = memoryStore();
  const handoff = createHandoff({store, session, id: () => 'x'});
  await handoff.save({file: photo()});
  store.records.clear();
  assert.deepEqual(await handoff.take(), {failed: true});
});

test('saving without a photo stores nothing', async () => {
  const session = memorySession(), store = memoryStore();
  assert.equal(await createHandoff({store, session}).save({}), false);
  assert.equal(store.records.size, 0);
  assert.equal(session.getItem(HANDOFF_FAILED_KEY), null);
});
