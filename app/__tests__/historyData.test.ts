import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCompleteHistory, type HistoryPageRequest } from '../lib/historyData';
import type { PriceHistoryRow } from '../lib/types';

test('history pagination reads beyond the server 1,000-row cap with a stable cutoff', async () => {
  const calls: HistoryPageRequest[] = [];
  const data: PriceHistoryRow[] = Array.from({ length: 1003 }, (_, i) => ({ sku_id: 'one', sale_price: i === 1002 ? 5 : 100, original_price: 120, recorded_at: '2026-09-01T00:00:00Z' }));
  const rows = await loadCompleteHistory(['one', 'one'], async (request) => {
    calls.push(request);
    return data.slice(request.from, request.to + 1);
  }, '2026-01-01T00:00:00Z', '2026-09-07T00:00:00Z');
  assert.equal(rows.length, 1003);
  assert.equal(rows.at(-1)?.sale_price, 5);
  assert.deepEqual(calls.map(({ from, to }) => [from, to]), [[0, 999], [1000, 1999]]);
  assert.ok(calls.every((call) => call.throughIso === '2026-09-07T00:00:00Z' && call.skuIds.length === 1));
});

test('history batches SKU filters and refuses a partial result when a later page fails', async () => {
  const lengths: number[] = [];
  await loadCompleteHistory(Array.from({ length: 91 }, (_, i) => String(i)), async ({ skuIds }) => { lengths.push(skuIds.length); return []; });
  assert.deepEqual(lengths, [45, 45, 1]);
  await assert.rejects(loadCompleteHistory(['one'], async ({ from }) => {
    if (from) throw new Error('offline');
    return Array.from({ length: 1000 }, () => ({ sale_price: 100, original_price: 120, recorded_at: '2026-09-01' }));
  }), /offline/);
});
