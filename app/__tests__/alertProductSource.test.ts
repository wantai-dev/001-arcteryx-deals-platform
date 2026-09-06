import assert from 'node:assert/strict';
import test from 'node:test';

import { productsToPriceCandidates } from '../lib/priceCandidateMapper';
import { product } from './helpers';

test('Yearbook-resolved unique-name SKU uses the watched catalog model key', () => {
  const deal = product({ sku_id: 'dealer-unique', official_product_id: null, model: 'Beta Jacket' });
  const candidates = productsToPriceCandidates([deal], new Map([
    ['dealer-unique', 'arcteryx:official:x123'],
  ]));
  assert.equal(candidates[0]?.modelKey, 'arcteryx:official:x123');
});

test('a resolved SKU mapping cannot relabel unrelated dealer SKUs', () => {
  const matched = product({ sku_id: 'matched', official_product_id: null, model: 'Beta Jacket' });
  const other = product({ sku_id: 'other', official_product_id: 'OTHER', model: 'Beta Jacket' });
  const candidates = productsToPriceCandidates([matched, other], new Map([
    ['matched', 'arcteryx:official:x123'],
  ]));
  assert.equal(candidates[0]?.modelKey, 'arcteryx:official:x123');
  assert.equal(candidates[1]?.modelKey, 'arcteryx:official:other');
});
