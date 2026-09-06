import assert from 'node:assert/strict';
import test from 'node:test';

import { makeScopedWatchEntry, saveEntryAlert } from '../lib/watchlist';
import { WatchlistStore, type WatchStorage } from '../lib/watchlistStore';
import { product } from './helpers';

class FakeStorage implements WatchStorage {
  value: string | null;
  writes: string[] = [];
  getGate: Promise<void> = Promise.resolve();
  failNextWrite = false;
  failNextRead = false;

  constructor(value: string | null) {
    this.value = value;
  }

  async getItem() {
    await this.getGate;
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('read unavailable');
    }
    return this.value;
  }

  async setItem(_key: string, value: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('disk full');
    }
    this.value = value;
    this.writes.push(value);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

test('mutation started before hydration waits and preserves loaded entries', async () => {
  const existing = makeScopedWatchEntry(product({ sku_id: 'old' }), 'sku', '2026-09-01T00:00:00Z')!;
  const storage = new FakeStorage(JSON.stringify([existing]));
  const gate = deferred();
  storage.getGate = gate.promise;
  const store = new WatchlistStore(storage);
  const pending = store.mutate((entries) => ({
    entries: [makeScopedWatchEntry(product({ sku_id: 'new' }), 'sku', '2026-09-02T00:00:00Z')!, ...entries],
    value: true,
  }));
  assert.equal(storage.writes.length, 0);
  gate.resolve();
  await pending;
  assert.deepEqual(store.snapshot().entries.map((entry) => entry.skuId), ['new', 'old']);
});

test('failed persistence does not publish optimistic state and queue recovers', async () => {
  const existing = makeScopedWatchEntry(product({ sku_id: 'old' }), 'sku', '2026-09-01T00:00:00Z')!;
  const storage = new FakeStorage(JSON.stringify([existing]));
  const store = new WatchlistStore(storage);
  await store.hydrate();
  const published: string[][] = [];
  store.subscribe((entries) => published.push(entries.map((entry) => entry.skuId)));
  storage.failNextWrite = true;
  await assert.rejects(() => store.mutate(() => ({ entries: [], value: undefined })), /disk full/);
  assert.deepEqual(store.snapshot().entries.map((entry) => entry.skuId), ['old']);
  assert.deepEqual(published, []);
  await store.mutate(() => ({ entries: [], value: undefined }));
  assert.deepEqual(store.snapshot().entries, []);
});

test('failed hydration stays unhydrated, writes nothing, and retries before mutation', async () => {
  const existing = makeScopedWatchEntry(product({ sku_id: 'old' }), 'sku', '2026-09-01T00:00:00Z')!;
  const storage = new FakeStorage(JSON.stringify([existing]));
  storage.failNextRead = true;
  const store = new WatchlistStore(storage);
  await assert.rejects(() => store.mutate(() => ({ entries: [], value: undefined })), /read unavailable/);
  assert.equal(store.snapshot().hydrated, false);
  assert.equal(storage.writes.length, 0);
  await store.mutate((entries) => ({ entries, value: undefined }));
  assert.equal(store.snapshot().hydrated, true);
  assert.equal(store.snapshot().entries[0]?.skuId, 'old');
  assert.equal(storage.writes.length, 1);
});

test('serialized concurrent alert writes enforce one free alert', async () => {
  const first = makeScopedWatchEntry(product({ sku_id: 'one' }), 'sku', '2026-09-01T00:00:00Z')!;
  const second = makeScopedWatchEntry(product({ sku_id: 'two' }), 'sku', '2026-09-01T00:00:00Z')!;
  const store = new WatchlistStore(new FakeStorage(JSON.stringify([first, second])));
  const draft = { mode: 'custom' as const, targetAmount: 90, targetCurrency: 'USD', localEnabled: true };
  const save = (id: string) => store.mutate((entries) => {
    const result = saveEntryAlert(entries, id, draft, false);
    return { entries: result.entries, value: result.accepted };
  });
  const results = await Promise.all([save(first.id!), save(second.id!)]);
  assert.deepEqual(results, [true, false]);
  assert.equal(store.snapshot().entries.filter((entry) => entry.alert).length, 1);
});
