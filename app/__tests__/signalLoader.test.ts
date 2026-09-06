import assert from 'node:assert/strict';
import test from 'node:test';
import { SignalLoader } from '../lib/signalLoader';
import type { PriceHistoryRow } from '../lib/types';
import { product } from './helpers';

test('overlapping signal requests share completion and stale responses cannot refill a refreshed cache', async () => {
  let finish!: (rows: PriceHistoryRow[]) => void;
  let reads = 0;
  let publishes = 0;
  const loader = new SignalLoader(() => { reads++; return new Promise((resolve) => { finish = resolve; }); }, () => { publishes++; });
  const first = loader.ensure([product()]);
  let secondDone = false;
  const second = loader.ensure([product()]).then(() => { secondDone = true; });
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(secondDone, false);
  loader.reset();
  finish([]);
  await Promise.all([first, second]);
  assert.equal(publishes, 0);
  const fresh = loader.ensure([product()]);
  await Promise.resolve();
  assert.equal(reads, 2);
  finish([]);
  await fresh;
  assert.equal(publishes, 1);
});

test('failed signal reads remain retryable without pretending to have coverage', async () => {
  let reads = 0;
  const loader = new SignalLoader(async () => { if (++reads === 1) throw new Error('offline'); return []; }, () => {});
  await assert.rejects(loader.ensure([product()]), /offline/);
  await loader.ensure([product()]);
  assert.equal(reads, 2);
});
