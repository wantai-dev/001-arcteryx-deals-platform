import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEO_INDEX_POLICY,
  assessProductIndexability,
  brandHubPath,
  normalizeExternalUrl,
} from '../api/seo-index.mjs';

const evaluatedAt = new Date('2026-09-07T12:00:00Z');
const eligible = {
  sku_id: 'evo:eligible',
  brand: 'burton',
  full_name: 'Burton Test Jacket',
  original_price: 200,
  sale_price: 100,
  discount_pct: 50,
  currency: 'USD',
  image_url: '//cdn.example.com/jacket.jpg',
  url: 'https://www.evo.com/test-jacket',
  dealer: 'evo',
  last_updated: '2026-09-07 08:00:00',
  url_http_status: 200,
  status: 'active',
  size_stock: { M: 'in_stock' },
};

test('shared SEO policy accepts a fresh, verified, high-discount product', () => {
  assert.equal(SEO_INDEX_POLICY.minimum_discount_pct, 45);
  assert.deepEqual(assessProductIndexability(eligible, evaluatedAt), {
    eligible: true,
    reasons: [],
  });
  assert.equal(normalizeExternalUrl('//cdn.example.com/jacket.jpg'), 'https://cdn.example.com/jacket.jpg');
});

test('shared SEO policy explains every failed gate', () => {
  const result = assessProductIndexability({
    ...eligible,
    discount_pct: 20,
    original_price: 100,
    sale_price: 80,
    url_http_status: 503,
    last_updated: '2026-08-01T00:00:00Z',
    size_stock: { M: 'out_of_stock' },
  }, evaluatedAt);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, [
    'source_unverified',
    'discount_below_threshold',
    'out_of_stock',
    'stale_observation',
  ]);
});

test('index eligibility derives discount from comparable prices instead of a conflicting label', () => {
  const result = assessProductIndexability({
    ...eligible,
    original_price: 100,
    sale_price: 90,
    discount_pct: 80,
  }, evaluatedAt);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('discount_below_threshold'));
});

test('index eligibility requires an explicit active lifecycle state', () => {
  const result = assessProductIndexability({ ...eligible, status: undefined }, evaluatedAt);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('inactive'));
});

test('brand breadcrumbs resolve to stable aggregation pages', () => {
  assert.equal(brandHubPath('arcteryx'), '/brands/arcteryx.html');
  assert.equal(brandHubPath('burton', 'en-US'), '/en/brands/burton.html');
  assert.equal(brandHubPath('unknown'), '/');
});
