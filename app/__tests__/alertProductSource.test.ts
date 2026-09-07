import assert from 'node:assert/strict';
import test from 'node:test';

import { productsToPriceCandidates } from '../lib/priceCandidateMapper';
import { product } from './helpers';

test('Yearbook-resolved unique-name SKU uses the watched catalog model key', () => {
  const deal = product({ sku_id: 'dealer-unique', official_product_id: null, model: 'Beta Jacket' });
  const candidates = productsToPriceCandidates([deal], {
    modelBySku: new Map([['dealer-unique', 'arcteryx:official:x123']]),
    catalogRejectedSkuIds: new Set(),
  });
  assert.equal(candidates[0]?.modelKey, 'arcteryx:official:x123');
});

test('a resolved SKU mapping cannot relabel unrelated dealer SKUs', () => {
  const matched = product({ sku_id: 'matched', official_product_id: null, model: 'Beta Jacket' });
  const other = product({ sku_id: 'other', official_product_id: 'OTHER', model: 'Beta Jacket' });
  const candidates = productsToPriceCandidates([matched, other], {
    modelBySku: new Map([['matched', 'arcteryx:official:x123']]),
    catalogRejectedSkuIds: new Set(),
  });
  assert.equal(candidates[0]?.modelKey, 'arcteryx:official:x123');
  assert.equal(candidates[1]?.modelKey, 'arcteryx:official:other');
});

test('a catalog-rejected ambiguous SKU cannot regain a fallback model key in the mapper', () => {
  const ambiguous = product({ sku_id: 'ambiguous', official_product_id: null, model: 'Beta Jacket' });
  const candidates = productsToPriceCandidates([ambiguous], {
    modelBySku: new Map(),
    catalogRejectedSkuIds: new Set(['ambiguous']),
  });
  assert.equal(candidates[0]?.modelKey, null);
});

test('an old-model SKU keeps its fallback key when no catalog rejected it', () => {
  const legacy = product({ sku_id: 'legacy', official_product_id: null, model: 'Legacy Jacket' });
  const candidates = productsToPriceCandidates([legacy]);
  assert.match(candidates[0]?.modelKey || '', /:fallback:/);
});
