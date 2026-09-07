import assert from 'node:assert/strict';
import test from 'node:test';
import { lowestComparableCandidate } from '../lib/candidateComparison';

const now = '2026-09-07T12:00:00Z';
const candidate = (skuId: string, price: number, currency: string, updatedAt = '2026-09-07T00:00:00Z') => ({ skuId, price, currency, name: skuId, symbol: '$', updatedAt });

test('cross-currency model prices require valid FX and compare through EUR', () => {
  const values = [candidate('usd', 100, 'USD'), candidate('cad', 105, 'CAD')];
  assert.equal(lowestComparableCandidate(values, null, now), null);
  assert.equal(lowestComparableCandidate(values, { date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 1.2, CAD: 1.5 } }, now)?.skuId, 'cad');
});

test('same-currency prices compare without FX', () => {
  assert.equal(lowestComparableCandidate([candidate('high', 110, 'USD'), candidate('low', 90, 'USD')], null, now)?.skuId, 'low');
});

test('EUR remains comparable when a mixed-currency conversion returns the original EUR amount', () => {
  const values = [candidate('eur', 90, 'EUR'), candidate('usd', 120, 'USD')];
  const rates = { date: '2026-09-07', fetchedAt: now, rates: { EUR: 1, USD: 1.2 } };
  assert.equal(lowestComparableCandidate(values, rates, now)?.skuId, 'eur');
});

test('invalid and stale prices are never presented as the current lowest offer', () => {
  const values = [
    candidate('zero', 0, 'USD'),
    candidate('nan', Number.NaN, 'USD'),
    candidate('stale', 10, 'USD', '2026-09-01T00:00:00Z'),
    candidate('fresh', 100, 'USD'),
  ];
  assert.equal(lowestComparableCandidate(values, null, now)?.skuId, 'fresh');
  assert.equal(lowestComparableCandidate(values.slice(0, 3), null, now), null);
});

test('stale FX does not support a mixed-currency lowest-price claim', () => {
  const rates = { date: '2026-09-01', fetchedAt: '2026-09-01T00:00:00Z', rates: { EUR: 1, USD: 1.2 } };
  assert.equal(lowestComparableCandidate([candidate('eur', 90, 'EUR'), candidate('usd', 100, 'USD')], rates, now), null);
});
