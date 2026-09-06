import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCurrentModelSkus } from '../lib/modelCandidateResolver';
import { makeScopedWatchEntry } from '../lib/watchlist';
import type { CatalogProduct } from '../lib/types';
import { product } from './helpers';

function catalog(id = 'X1234567', overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    catalog_product_id: `arcteryx:${id.toLowerCase()}`, brand_key: 'arcteryx', official_product_id: id,
    brand: "Arc'teryx", catalog_scope: 'full_price', market: 'outdoor', country: 'us', language: 'en',
    name: 'Beta Jacket', gender: 'men', collection: null, categories: ['jackets'], category_sources: {},
    list_price: 400, list_price_max: 400, currency: 'USD', color_names: [], primary_colors: [], season_codes: [],
    source_name: 'arcteryx_us_official_product_feed', source_url: 'https://arcteryx.com/us/en/shop/mens/beta-jacket',
    source_hash: 'a'.repeat(64), status: 'active', first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-09-07T00:00:00Z', last_changed_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function deal(skuId: string, overrides = {}) {
  return product({
    sku_id: skuId, brand: 'arcteryx', _brand: 'arcteryx', model: 'Beta Jacket', full_name: 'Beta Jacket',
    gender: 'men', category: 'jackets', original_price: 400, sale_price: 300, discount_pct: 25,
    official_product_id: null, ...overrides,
  });
}

test('runtime resolution includes a newly listed SKU absent from the saved compatibility snapshot', () => {
  const style = catalog();
  const entry = makeScopedWatchEntry(style, 'model', '2026-09-01T00:00:00Z', [deal('old')])!;
  const resolved = resolveCurrentModelSkus([entry], [style], [deal('old'), deal('new')]);
  assert.equal(resolved.get('old'), entry.modelKey);
  assert.equal(resolved.get('new'), entry.modelKey);
});

test('runtime resolution rejects a formerly saved SKU after it gains a different official identity', () => {
  const watched = catalog();
  const other = catalog('X7654321', { name: 'Alpha Jacket', source_url: 'https://arcteryx.com/us/en/shop/mens/alpha-jacket' });
  const entry = makeScopedWatchEntry(watched, 'model', '2026-09-01T00:00:00Z', [deal('changed')])!;
  const changed = deal('changed', { official_product_id: 'X7654321', model: 'Beta Jacket' });
  assert.equal(resolveCurrentModelSkus([entry], [watched, other], [changed]).has('changed'), false);
});

test('runtime resolution has no 200-SKU ceiling', () => {
  const style = catalog();
  const entry = makeScopedWatchEntry(style, 'model')!;
  const deals = Array.from({ length: 275 }, (_, index) => deal(`sku-${index}`));
  assert.equal(resolveCurrentModelSkus([entry], [style], deals).size, 275);
});

test('runtime resolution refuses ambiguous exact-name matches', () => {
  const first = catalog();
  const second = catalog('X7654321');
  const entry = makeScopedWatchEntry(first, 'model')!;
  assert.equal(resolveCurrentModelSkus([entry], [first, second], [deal('ambiguous')]).size, 0);
});
