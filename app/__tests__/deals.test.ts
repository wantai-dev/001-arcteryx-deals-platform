import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableDealRegions,
  DEAL_PAGE_SIZE,
  DEFAULT_DEAL_FILTERS,
  filterDeals,
  nextDealVisibleLimit,
} from '../lib/deals';
import type { RateSnapshot } from '../lib/currency';
import { product } from './helpers';

const products = [
  product({ sku_id: 'beta-us', region: 'us', sale_price: 300, discount_pct: 25 }),
  product({ sku_id: 'beta-ca', region: 'ca', sale_price: 350, discount_pct: 30, symbol: 'C$', currency: 'CAD' }),
  product({ sku_id: 'beta-de', region: 'de', sale_price: 280, discount_pct: 35, symbol: '€', currency: 'EUR' }),
];

test('deal pagination never collapses the first page while results are loading', () => {
  const afterEmptyEndReached = nextDealVisibleLimit(DEAL_PAGE_SIZE, 0);
  assert.equal(afterEmptyEndReached, DEAL_PAGE_SIZE);
  assert.equal(Array.from({ length: 30 }).slice(0, afterEmptyEndReached).length, 30);
  assert.equal(nextDealVisibleLimit(0, 30), DEAL_PAGE_SIZE);
});

test('deal pagination stays monotonic when results shrink and later expand', () => {
  assert.equal(nextDealVisibleLimit(600, 20), 600);
  assert.equal(nextDealVisibleLimit(600, 900), 900);
  assert.equal(nextDealVisibleLimit(900, 1_200), 1_200);
});

test('region filtering returns deals for each loaded country', () => {
  assert.deepEqual(filterDeals(products, 'ca', '', DEFAULT_DEAL_FILTERS).map((item) => item.sku_id), ['beta-ca']);
  assert.deepEqual(filterDeals(products, 'de', '', DEFAULT_DEAL_FILTERS).map((item) => item.sku_id), ['beta-de']);
  assert.deepEqual(filterDeals(products, 'all', '', DEFAULT_DEAL_FILTERS).map((item) => item.sku_id), ['beta-de', 'beta-ca', 'beta-us']);
});

test('region menu only includes countries present in the loaded catalog', () => {
  assert.deepEqual(availableDealRegions(products), ['all', 'us', 'ca', 'de']);
  assert.equal(availableDealRegions(products).includes('jp'), false);
});

test('search and secondary filters still apply within the selected country', () => {
  assert.equal(filterDeals(products, 'de', 'beta', DEFAULT_DEAL_FILTERS).length, 1);
  assert.equal(filterDeals(products, 'de', 'gamma', DEFAULT_DEAL_FILTERS).length, 0);
  assert.equal(filterDeals(products, 'de', '', { ...DEFAULT_DEAL_FILTERS, platform: 'mec' }).length, 0);
});

test('brand filtering and search work across the multi-brand catalog', () => {
  const mixed = [
    ...products,
    product({
      sku_id: 'burton-custom-us',
      brand: 'burton',
      _brand: 'burton',
      model: 'Burton Custom Camber Snowboard',
      full_name: 'Burton Custom Camber Snowboard',
      category: '滑雪板',
      dealer: 'burton',
      _platform: 'burton',
      url: 'https://www.burton.com/en-us/products/custom-camber-snowboard-106881',
    }),
  ];

  assert.deepEqual(
    filterDeals(mixed, 'us', '', { ...DEFAULT_DEAL_FILTERS, brand: 'burton' }).map((item) => item.sku_id),
    ['burton-custom-us'],
  );
  assert.deepEqual(
    filterDeals(mixed, 'us', 'burton custom', DEFAULT_DEAL_FILTERS).map((item) => item.sku_id),
    ['burton-custom-us'],
  );
  const arcteryx = product({
    sku_id: 'arcteryx-beta-us',
    brand: 'arcteryx',
    _brand: 'arcteryx',
    model: 'Beta Jacket',
    full_name: "Arc'teryx Beta Jacket",
  });
  assert.deepEqual(
    filterDeals([arcteryx], 'us', "Arc'teryx", DEFAULT_DEAL_FILTERS).map((item) => item.sku_id),
    ['arcteryx-beta-us'],
  );
  assert.deepEqual(
    filterDeals([arcteryx], 'us', 'Arc teryx', DEFAULT_DEAL_FILTERS).map((item) => item.sku_id),
    ['arcteryx-beta-us'],
  );
});

test('applies discount thresholds and only keeps loaded low signals', () => {
  const rows = [
    product({ sku_id: 'low-50', discount_pct: 55 }),
    product({ sku_id: 'not-low-40', discount_pct: 40 }),
    product({ sku_id: 'small-20', discount_pct: 20 }),
  ];
  const filtered = filterDeals(rows, 'all', '', {
    ...DEFAULT_DEAL_FILTERS,
    minDiscount: 30,
    lowOnly: true,
  }, {
    signals: {
      'low-50': { kind: 'all_time_low', label: '', tone: 'success', verdict: '', isLow: true, minPrice: 1, pointCount: 3 },
      'not-low-40': { kind: 'steady', label: '', tone: 'neutral', verdict: '', isLow: false, minPrice: 1, pointCount: 3 },
    },
  });
  assert.deepEqual(filtered.map((item) => item.sku_id), ['low-50']);
});

test('sorts source currencies by converted value and puts unavailable rates last', () => {
  const rows = [
    product({ sku_id: 'cad', sale_price: 130, currency: 'CAD' }),
    product({ sku_id: 'usd', sale_price: 100, currency: 'USD' }),
    product({ sku_id: 'unknown', sale_price: 1, currency: 'XYZ' }),
  ];
  const snapshot: RateSnapshot = {
    date: '2026-09-06',
    fetchedAt: '2026-09-06T00:00:00Z',
    rates: { EUR: 1, USD: 1.2, CAD: 1.8 },
  };
  const sorted = filterDeals(rows, 'all', '', { ...DEFAULT_DEAL_FILTERS, sort: 'price_asc' }, {
    targetCurrency: 'EUR',
    rateSnapshot: snapshot,
  });
  assert.deepEqual(sorted.map((item) => item.sku_id), ['cad', 'usd', 'unknown']);
});
