import assert from 'node:assert/strict';
import test from 'node:test';

import { modelIdentity, modelKeyForCatalogProduct, modelKeyForProduct, sameModel } from '../lib/modelWatch';
import { product } from './helpers';
import type { CatalogProduct } from '../lib/types';

function catalog(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    catalog_product_id: 'burton:123', brand_key: 'burton', official_product_id: '123',
    brand: 'Burton', catalog_scope: 'full_price', market: 'snow', country: 'us',
    language: 'en', name: 'Custom Camber', gender: 'men', collection: null,
    categories: ['snowboards'], category_sources: {}, list_price: 699,
    list_price_max: 699, currency: 'USD', color_names: [], primary_colors: [],
    season_codes: [], source_name: 'official', source_url: 'https://example.com',
    source_hash: 'hash', status: 'active', first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-01T00:00:00Z', last_changed_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('official identity is shared across deal and catalog sources', () => {
  const deal = product({ brand: 'burton', _brand: 'burton', official_product_id: '123', model: 'Other display name' });
  assert.equal(modelKeyForProduct(deal), 'burton:official:123');
  assert.equal(modelKeyForCatalogProduct(catalog()), 'burton:official:123');
  assert.equal(sameModel(deal, catalog()), true);
});

test('fallback identity includes gender and category to avoid ambiguous merges', () => {
  const men = product({ official_product_id: null, model: 'Beta Jacket', gender: 'men', category: '夹克' });
  const women = product({ official_product_id: null, model: 'Beta Jacket', gender: 'women', category: '夹克' });
  assert.notEqual(modelKeyForProduct(men), modelKeyForProduct(women));
});

test('fallback refuses unknown gender or missing category', () => {
  assert.equal(modelIdentity(product({ official_product_id: null, gender: null, category: '夹克' })), null);
  assert.equal(modelIdentity(product({ official_product_id: null, gender: 'men', category: null })), null);
});
