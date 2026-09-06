import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeAlertCount,
  FREE_ALERT_LIMIT,
  FREE_WATCHLIST_LIMIT,
  makeScopedWatchEntry,
  parseWatchEntries,
  parseStoredWatchEntries,
  saveEntryAlert,
  saveSourceAlert,
  setWatchAlertTarget,
  toggleWatchEntry,
  WATCHLIST_STORAGE_KEY,
} from '../lib/watchlist';
import { product } from './helpers';
import type { CatalogProduct, WatchEntry } from '../lib/types';

function entries(count: number): WatchEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    skuId: `sku-${index}`,
    savedAt: '2026-07-07T12:00:00.000Z',
    savedPrice: 100 + index,
    symbol: '$',
  }));
}

test('watchlist storage key is stable for AsyncStorage persistence', () => {
  assert.equal(WATCHLIST_STORAGE_KEY, 'geardrop.watchlist.v1');
});

test('parseWatchEntries tolerates empty, invalid, and non-array storage values', () => {
  assert.deepEqual(parseWatchEntries(null), []);
  assert.deepEqual(parseWatchEntries('not json'), []);
  assert.deepEqual(parseWatchEntries('{"skuId":"x"}'), []);
  assert.deepEqual(parseWatchEntries('[{"skuId":"x","savedAt":"now","savedPrice":1,"symbol":"$"}]'), [
    { skuId: 'x', savedAt: 'now', savedPrice: 1, symbol: '$' },
  ]);
});

test('toggleWatchEntry prepends a saved product with a price snapshot', () => {
  const current = product({ sku_id: 'new-sku', sale_price: 180, symbol: '€' });
  const result = toggleWatchEntry([], current, false, '2026-07-07T12:00:00.000Z');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.entries[0], {
    skuId: 'new-sku',
    savedAt: '2026-07-07T12:00:00.000Z',
    savedPrice: 180,
    symbol: '€',
  });
});

test('toggleWatchEntry removes an already-saved product', () => {
  const current = product({ sku_id: 'sku-1' });
  const result = toggleWatchEntry(entries(3), current, false, '2026-07-07T12:00:00.000Z');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.entries.map((entry) => entry.skuId), ['sku-0', 'sku-2']);
});

test('toggleWatchEntry enforces the free watchlist limit but lets Pro exceed it', () => {
  const full = entries(FREE_WATCHLIST_LIMIT);
  const current = product({ sku_id: 'sku-over-limit' });
  const freeResult = toggleWatchEntry(full, current, false, '2026-07-07T12:00:00.000Z');
  const proResult = toggleWatchEntry(full, current, true, '2026-07-07T12:00:00.000Z');

  assert.equal(freeResult.accepted, false);
  assert.equal(freeResult.entries.length, FREE_WATCHLIST_LIMIT);
  assert.equal(proResult.accepted, true);
  assert.equal(proResult.entries.length, FREE_WATCHLIST_LIMIT + 1);
  assert.equal(proResult.entries[0]?.skuId, 'sku-over-limit');
});

test('setWatchAlertTarget creates, updates, and clears local alert targets', () => {
  const current = product({ sku_id: 'alert-sku', sale_price: 220, symbol: '£' });
  const created = setWatchAlertTarget([], current, 150, '2026-07-07T12:00:00.000Z');

  assert.deepEqual(created[0], {
    skuId: 'alert-sku',
    savedAt: '2026-07-07T12:00:00.000Z',
    savedPrice: 220,
    symbol: '£',
    alertTarget: 150,
  });

  const cleared = setWatchAlertTarget(created, current, null, '2026-07-08T12:00:00.000Z');
  assert.equal(cleared[0]?.skuId, 'alert-sku');
  assert.equal(cleared[0]?.alertTarget, undefined);
  assert.equal(cleared[0]?.savedAt, '2026-07-07T12:00:00.000Z');
});

test('v1 entries migrate to stable sku IDs without losing legacy fields', () => {
  const migrated = parseStoredWatchEntries('[{"skuId":"x","savedAt":"2026-09-01T00:00:00Z","savedPrice":1,"symbol":"$"}]');
  assert.equal(migrated[0]?.id, 'sku:x');
  assert.equal(migrated[0]?.scope, 'sku');
  assert.equal(migrated[0]?.savedPrice, 1);
});

test('stored migration drops invalid rows, deduplicates IDs, and isolates malformed alerts', () => {
  const valid = makeScopedWatchEntry(product({ sku_id: 'valid' }), 'sku', '2026-09-01T00:00:00Z')!;
  const malformedAlert = { ...valid, alert: { mode: 'custom', targetAmount: 2, targetCurrency: '$', localEnabled: true, armed: true, rearmAbove: 3 } };
  const migrated = parseStoredWatchEntries(JSON.stringify([
    malformedAlert,
    valid,
    { ...valid, id: 'sku:bad-date', skuId: 'bad-date', savedAt: 'not-a-date' },
    { ...valid, id: 'sku:bad-price', skuId: 'bad-price', savedPrice: Number.NaN },
  ]));
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0]?.id, 'sku:valid');
  assert.equal(migrated[0]?.alert, undefined);
});

test('model entries never invent a queryable sku', () => {
  const entry = makeScopedWatchEntry(product({ official_product_id: 'X123' }), 'model', 'now');
  assert.equal(entry?.id, 'model:arcteryx:official:x123');
  assert.equal(entry?.skuId, '');
  assert.equal(entry?.snapshot?.skuId, 'beta-jacket_Black_us');
});

test('model entries persist only the bounded Yearbook-resolved dealer SKU mapping', () => {
  const catalogSource: CatalogProduct = {
    catalog_product_id: 'arcteryx:x123', brand_key: 'arcteryx', official_product_id: 'X123', brand: "Arc'teryx",
    catalog_scope: 'full_price', market: 'outdoor', country: 'us', language: 'en', name: 'Beta Jacket', gender: 'men',
    collection: null, categories: ['jackets'], category_sources: {}, list_price: 400, list_price_max: 400,
    currency: 'USD', color_names: [], primary_colors: [], season_codes: [], source_name: 'official',
    source_url: 'https://arcteryx.com/us/en/shop/mens/beta-jacket', source_hash: 'hash', status: 'active',
    first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z', last_changed_at: '2026-01-01T00:00:00Z',
  };
  const offers = [product({ sku_id: 'dealer-a' }), product({ sku_id: 'dealer-a' }), product({ sku_id: 'dealer-b' })];
  const entry = makeScopedWatchEntry(catalogSource, 'model', '2026-09-07T00:00:00Z', offers)!;
  assert.deepEqual(entry.snapshot?.resolvedSkuIds, ['dealer-a', 'dealer-b']);
  assert.equal(entry.snapshot?.skuId, 'dealer-a');
});

test('free alert quota allows replacing self but rejects a second active alert', () => {
  assert.equal(FREE_ALERT_LIMIT, 1);
  const first = makeScopedWatchEntry(product({ sku_id: 'one' }), 'sku', 'now')!;
  const second = makeScopedWatchEntry(product({ sku_id: 'two' }), 'sku', 'now')!;
  const draft = { mode: 'custom' as const, targetAmount: 90, targetCurrency: 'USD', localEnabled: true };
  const created = saveEntryAlert([first, second], first.id!, draft, false);
  assert.equal(created.accepted, true);
  assert.equal(activeAlertCount(created.entries), 1);
  const replaced = saveEntryAlert(created.entries, first.id!, { ...draft, targetAmount: 80 }, false);
  assert.equal(replaced.accepted, true);
  assert.equal(replaced.entries[0]?.alert?.targetAmount, 80);
  const rejected = saveEntryAlert(replaced.entries, second.id!, draft, false);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'alert-limit');
  assert.equal(activeAlertCount(rejected.entries), 1);
});

test('source alert atomically creates the selected model watch and alert', () => {
  const source = product({ sku_id: 'model-source', official_product_id: 'X1234567' });
  const result = saveSourceAlert([], source, 'model', {
    mode: 'percent10', targetAmount: 90, targetCurrency: 'USD', localEnabled: true,
  }, false);
  assert.equal(result.accepted, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.scope, 'model');
  assert.equal(result.entries[0]?.skuId, '');
  assert.equal(result.entries[0]?.alert?.targetAmount, 90);
});

test('source alert quota failure does not leave a newly-created watch behind', () => {
  const first = makeScopedWatchEntry(product({ sku_id: 'first' }), 'sku')!;
  const active = saveEntryAlert([first], first.id!, {
    mode: 'custom', targetAmount: 90, targetCurrency: 'USD', localEnabled: true,
  }, false).entries;
  const result = saveSourceAlert(active, product({ sku_id: 'second' }), 'sku', {
    mode: 'custom', targetAmount: 80, targetCurrency: 'USD', localEnabled: true,
  }, false);
  assert.equal(result.accepted, false);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries.some((entry) => entry.skuId === 'second'), false);
});
