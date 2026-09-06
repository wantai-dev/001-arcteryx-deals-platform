import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePriceAlerts, restoreFailedDeliveries, type PriceCandidate } from '../lib/priceMonitor';
import { makeScopedWatchEntry, saveEntryAlert } from '../lib/watchlist';
import { product } from './helpers';

const now = '2026-09-07T12:00:00.000Z';

function armedEntry(overrides = {}) {
  const source = product({ sku_id: 'sku-one', sale_price: 100, currency: 'USD', ...overrides });
  const entry = makeScopedWatchEntry(source, 'sku', now)!;
  return saveEntryAlert([entry], entry.id!, {
    mode: 'custom', targetAmount: 90, targetCurrency: source.currency, localEnabled: true,
  }, false).entries[0]!;
}

function candidate(overrides: Partial<PriceCandidate> = {}): PriceCandidate {
  return {
    skuId: 'sku-one', name: 'Beta Jacket', price: 89, currency: 'USD', symbol: '$',
    updatedAt: '2026-09-07T11:00:00.000Z', ...overrides,
  };
}

test('crossing the target emits once and stays disarmed until price rearms', () => {
  const first = evaluatePriceAlerts([armedEntry()], [candidate()], null, now);
  assert.equal(first.events.length, 1);
  assert.equal(first.entries[0]?.alert?.armed, false);
  const duplicate = evaluatePriceAlerts(first.entries, [candidate()], null, '2026-09-07T13:00:00.000Z');
  assert.equal(duplicate.events.length, 0);
  const rearmed = evaluatePriceAlerts(duplicate.entries, [candidate({ price: 93 })], null, '2026-09-07T14:00:00.000Z');
  assert.equal(rearmed.entries[0]?.alert?.armed, true);
  const second = evaluatePriceAlerts(rearmed.entries, [candidate({ price: 88 })], null, '2026-09-07T15:00:00.000Z');
  assert.equal(second.events.length, 1);
});

test('stale product data never triggers', () => {
  const result = evaluatePriceAlerts(
    [armedEntry()], [candidate({ updatedAt: '2026-09-01T00:00:00.000Z' })], null, now,
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.skippedStaleProducts, 1);
});

test('missing or stale FX never triggers a cross-currency alert', () => {
  const eur = armedEntry({ currency: 'EUR' });
  const missing = evaluatePriceAlerts([eur], [candidate({ currency: 'USD' })], null, now);
  assert.equal(missing.events.length, 0);
  assert.equal(missing.skippedFx, 1);
  const staleRates = {
    date: '2026-09-01', fetchedAt: '2026-09-01T00:00:00.000Z', rates: { EUR: 1, USD: 1.2 },
  };
  assert.equal(evaluatePriceAlerts([eur], [candidate({ currency: 'USD' })], staleRates, now).events.length, 0);
});

test('fresh FX compares in the explicit target currency', () => {
  const eur = armedEntry({ currency: 'EUR' });
  const rates = {
    date: '2026-09-07', fetchedAt: '2026-09-07T11:30:00.000Z', rates: { EUR: 1, USD: 1.2 },
  };
  const result = evaluatePriceAlerts([eur], [candidate({ currency: 'USD', price: 100 })], rates, now);
  assert.equal(result.events.length, 1);
  assert.ok(Math.abs(result.events[0]!.price - 83.3333) < 0.01);
});

test('model alert chooses the lowest matching SKU and ignores other models', () => {
  const source = product({ official_product_id: 'X123', sale_price: 100 });
  const entry = makeScopedWatchEntry(source, 'model', now)!;
  const watched = saveEntryAlert([entry], entry.id!, {
    mode: 'custom', targetAmount: 90, targetCurrency: 'USD', localEnabled: true,
  }, false).entries;
  const result = evaluatePriceAlerts(watched, [
    candidate({ skuId: 'red', modelKey: entry.modelKey, price: 88 }),
    candidate({ skuId: 'blue', modelKey: entry.modelKey, price: 85 }),
    candidate({ skuId: 'other', modelKey: 'arcteryx:official:other', price: 1 }),
  ], null, now);
  assert.equal(result.events[0]?.skuId, 'blue');
});

test('failed local notification delivery restores the armed state', () => {
  const original = [armedEntry()];
  const evaluated = evaluatePriceAlerts(original, [candidate()], null, now);
  const restored = restoreFailedDeliveries(original, evaluated.entries, new Set([original[0]!.id!]));
  assert.equal(restored[0]?.alert?.armed, true);
  assert.equal(restored[0]?.alert?.lastTriggeredAt, undefined);
});
