import assert from 'node:assert/strict';
import test from 'node:test';

import { findCheaperAlternatives, hasUncomparableRegionalOffer } from '../lib/cheaperAlternatives';
import type { RateSnapshot } from '../lib/currency';
import { product } from './helpers';

const rates: RateSnapshot = {
  date: '2026-09-06',
  fetchedAt: '2026-09-06T12:00:00Z',
  rates: { EUR: 1, CAD: 1.6055, GBP: 0.86, USD: 1.17 },
};
const CAD_RATE = 1.6055;
const GBP_RATE = 0.86;

const dieneCanada = product({
  sku_id: 'diene-shirt-ls-black-ca',
  model: 'Diene Shirt LS',
  region: 'ca',
  currency: 'CAD',
  sale_price: 175,
});

test('does not call a numerically lower foreign price cheaper when conversion makes it more expensive', () => {
  const uk = product({
    sku_id: 'diene-shirt-ls-black-gb',
    model: 'Diene Shirt LS',
    region: 'gb',
    currency: 'GBP',
    sale_price: 160,
  });

  assert.ok(160 < 175, 'fixture must reproduce the raw-number comparison bug');
  assert.ok((160 / GBP_RATE) > (175 / CAD_RATE), 'fixture must be more expensive after conversion');
  assert.deepEqual(findCheaperAlternatives([dieneCanada, uk], dieneCanada, rates), []);
});

test('returns only genuinely cheaper cross-currency offers and keeps one lowest offer per region', () => {
  const products = [
    dieneCanada,
    product({ sku_id: 'uk-more-expensive', model: 'Diene Shirt LS', region: 'gb', currency: 'GBP', sale_price: 100 }),
    product({ sku_id: 'uk-cheapest', model: 'Diene Shirt LS', region: 'gb', currency: 'GBP', sale_price: 80 }),
    product({ sku_id: 'us-cheaper', model: 'Diene Shirt LS', region: 'us', currency: 'USD', sale_price: 120 }),
  ];

  assert.deepEqual(
    findCheaperAlternatives(products, dieneCanada, rates).map((item) => item.sku_id),
    ['uk-cheapest', 'us-cheaper'],
  );
});

test('missing, non-finite, or non-positive exchange rates never produce a cross-currency cheaper claim', () => {
  const foreign = product({ sku_id: 'foreign', model: 'Diene Shirt LS', region: 'gb', currency: 'GBP', sale_price: 1 });
  const invalidSnapshots: (RateSnapshot | null)[] = [
    null,
    { ...rates, rates: { EUR: 1, CAD: CAD_RATE } },
    { ...rates, rates: { ...rates.rates, GBP: 0 } },
    { ...rates, rates: { ...rates.rates, GBP: Number.NaN } },
    { ...rates, rates: { ...rates.rates, CAD: Number.POSITIVE_INFINITY } },
  ];
  for (const snapshot of invalidSnapshots) {
    assert.deepEqual(findCheaperAlternatives([dieneCanada, foreign], dieneCanada, snapshot), []);
    assert.equal(hasUncomparableRegionalOffer([dieneCanada, foreign], dieneCanada, snapshot), true);
  }
});

test('same-currency peers do not make the comparison status unavailable without FX', () => {
  const peer = product({ sku_id: 'peer', model: 'Diene Shirt LS', region: 'us', currency: 'CAD', sale_price: 200 });
  assert.equal(hasUncomparableRegionalOffer([dieneCanada, peer], dieneCanada, null), false);
});

test('same-currency offers remain comparable without rates and ties sort deterministically', () => {
  const base = product({ sku_id: 'base-us', model: 'Beta Jacket', region: 'us', currency: 'USD', sale_price: 300 });
  const products = [
    base,
    product({ sku_id: 'z-ca', model: 'Beta Jacket', region: 'ca', currency: 'USD', sale_price: 250 }),
    product({ sku_id: 'a-ca', model: 'Beta Jacket', region: 'ca', currency: 'USD', sale_price: 250 }),
    product({ sku_id: 'de', model: 'Beta Jacket', region: 'de', currency: 'USD', sale_price: 250 }),
  ];
  assert.deepEqual(findCheaperAlternatives(products, base, null).map((item) => item.sku_id), ['a-ca', 'de']);
});

test('keeps brand, model, current-region, self, price, and limit constraints', () => {
  const valid = product({ sku_id: 'valid', model: 'Diene Shirt LS', region: 'us', currency: 'CAD', sale_price: 100 });
  const excluded = [
    product({ sku_id: 'brand', _brand: 'burton', model: 'Diene Shirt LS', region: 'de', currency: 'CAD', sale_price: 1 }),
    product({ sku_id: 'model', model: 'Other', region: 'fr', currency: 'CAD', sale_price: 1 }),
    product({ sku_id: 'same-region', model: 'Diene Shirt LS', region: 'ca', currency: 'CAD', sale_price: 1 }),
    product({ sku_id: 'zero', model: 'Diene Shirt LS', region: 'gb', currency: 'CAD', sale_price: 0 }),
  ];
  assert.deepEqual(findCheaperAlternatives([dieneCanada, valid, ...excluded], dieneCanada, rates, 1), [valid]);
  assert.deepEqual(findCheaperAlternatives([dieneCanada, valid], dieneCanada, rates, 0), []);
});
