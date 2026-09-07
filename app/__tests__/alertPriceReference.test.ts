import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertPriceReferenceForCatalog,
  alertPriceReferenceForProduct,
  convertAlertPriceReference,
  initialAlertEditorValue,
  makeAlertPriceReference,
  shouldInitializeAlertEditor,
  validAlertTargetCurrency,
  watchAlertPriceReference,
} from '../lib/alertPriceReference';
import { alertSheetCopy } from '../lib/watchI18n';
import type { CatalogProduct, WatchEntry } from '../lib/types';
import { product } from './helpers';

const now = '2026-09-07T12:00:00Z';
const rates = {
  date: '2026-09-07', fetchedAt: '2026-09-07T10:00:00Z',
  rates: { EUR: 1, USD: 1.1, CNY: 8, AUD: 1.7 },
};

function watchedEntry(): WatchEntry {
  return {
    id: 'model:patagonia:official:37996', scope: 'model', modelKey: 'patagonia:official:37996', skuId: '',
    savedAt: now, savedPrice: 49.95, symbol: 'A$', savedMoney: { amount: 49.95, currency: 'AUD' },
    snapshot: { brand: 'patagonia', name: 'Airfarer Cap', catalogProductId: 'patagonia:37996', currency: 'AUD', symbol: 'A$', price: 49.95 },
  };
}

function catalogProduct(): CatalogProduct {
  return {
    catalog_product_id: 'patagonia:37996', brand_key: 'patagonia', official_product_id: '37996', brand: 'Patagonia',
    catalog_scope: 'full_price', market: 'outdoor', country: 'au', language: 'en', name: 'Airfarer Cap', gender: 'unisex',
    collection: null, categories: ['hats'], category_sources: {}, list_price: 49.95, list_price_max: 49.95,
    currency: 'AUD', color_names: [], primary_colors: [], season_codes: [], source_name: 'Patagonia AU',
    source_url: 'https://www.patagonia.com.au/products/airfarer-cap-37996', source_hash: 'hash', status: 'active',
    first_seen_at: now, last_seen_at: now, last_changed_at: now,
  };
}

test('a catalog product with no deal remains an official reference instead of becoming a live offer', () => {
  assert.deepEqual(alertPriceReferenceForCatalog(catalogProduct()), {
    kind: 'catalog', amount: 49.95, currency: 'AUD', symbol: 'AUD',
  });
});

test('a watched snapshot remains saved when no current candidate exists', () => {
  assert.deepEqual(watchAlertPriceReference(watchedEntry(), null), {
    kind: 'saved', amount: 49.95, currency: 'AUD', symbol: 'A$',
  });
});

test('a fresh candidate overrides the saved reference without requiring a Product lookup', () => {
  assert.deepEqual(watchAlertPriceReference(watchedEntry(), {
    skuId: 'dealer-only', modelKey: 'patagonia:official:37996', name: 'Airfarer Cap',
    price: 42, currency: 'USD', symbol: '$', updatedAt: now,
  }), { kind: 'live', amount: 42, currency: 'USD', symbol: '$' });
});

test('invalid references and missing FX cannot enable automatic percentage targets', () => {
  assert.deepEqual(makeAlertPriceReference('live', Number.NaN, 'USD'), { kind: 'unavailable', currency: 'USD' });
  assert.deepEqual(makeAlertPriceReference('saved', 20, '$'), { kind: 'unavailable' });
  const reference = makeAlertPriceReference('saved', 20, 'USD', '$');
  assert.equal(convertAlertPriceReference(reference, 'CNY', null, now), null);
  assert.equal(convertAlertPriceReference(reference, 'CNY', { ...rates, fetchedAt: '2026-09-01T00:00:00Z' }, now), null);
  assert.deepEqual(initialAlertEditorValue(reference, 'CNY', undefined, null, now), {
    mode: 'custom', target: '', currency: 'USD',
  });
});

test('invalid saved amounts preserve a known supported currency for a future custom threshold', () => {
  const entry = watchedEntry();
  entry.savedMoney = { amount: Number.NaN, currency: 'AUD' };
  entry.snapshot = { ...entry.snapshot!, price: 0 };
  assert.deepEqual(watchAlertPriceReference(entry, null), { kind: 'unavailable', currency: 'AUD' });
});

test('alert targets accept only the ten currencies supported by the project', () => {
  for (const currency of ['EUR', 'USD', 'CAD', 'GBP', 'JPY', 'CHF', 'CNY', 'SEK', 'DKK', 'AUD']) {
    assert.equal(validAlertTargetCurrency(currency), true, currency);
  }
  for (const currency of ['XXX', 'ZZZ', 'usd', '$', '']) {
    assert.equal(validAlertTargetCurrency(currency), false, currency);
  }
  assert.deepEqual(makeAlertPriceReference('saved', 20, 'ZZZ'), { kind: 'unavailable' });
});

test('stale or invalid product rows cannot be labeled as a live alert price', () => {
  assert.deepEqual(alertPriceReferenceForProduct(product({ last_updated: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-01T00:00:00Z' }), rates, now), {
    kind: 'unavailable', currency: 'USD',
  });
  assert.deepEqual(alertPriceReferenceForProduct(product({ sale_price: 0 }), rates, now), {
    kind: 'unavailable', currency: 'USD',
  });
});

test('an old alert keeps its amount but becomes custom when its reference is unavailable', () => {
  const existing = { mode: 'percent10' as const, targetAmount: 200, targetCurrency: 'CNY', localEnabled: true, armed: true, rearmAbove: 204 };
  assert.deepEqual(initialAlertEditorValue({ kind: 'unavailable', currency: 'AUD' }, 'AUD', existing, rates, now), {
    mode: 'custom', target: 200, currency: 'CNY',
  });
});

test('an async reference refresh does not reinitialize the same open editor session', () => {
  assert.equal(shouldInitializeAlertEditor(null, true, 'sku:one:sku'), true);
  assert.equal(shouldInitializeAlertEditor('sku:one:sku', true, 'sku:one:sku'), false);
  assert.equal(shouldInitializeAlertEditor('sku:one:sku', false, 'sku:one:sku'), false);
  assert.equal(shouldInitializeAlertEditor('sku:one:sku', true, 'sku:two:sku'), true);
});

test('all five languages distinguish live, catalog, saved, and unavailable price semantics', () => {
  for (const language of ['en', 'zh-Hans', 'de', 'fr', 'ja'] as const) {
    const copy = alertSheetCopy(language);
    assert.equal(new Set([copy.liveReference, copy.catalogReference, copy.savedReference, copy.unavailableReference]).size, 4);
    assert.ok(copy.catalogNote.length > 12);
    assert.ok(copy.savedNote.length > 12);
    assert.ok(copy.futureThreshold.length > 12);
    assert.notEqual(copy.targetBelow('live'), copy.targetBelow('catalog'));
    assert.notEqual(copy.targetBelow('catalog'), copy.targetBelow('saved'));
  }
});
