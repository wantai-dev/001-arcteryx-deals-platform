import assert from 'node:assert/strict';
import test from 'node:test';
import { lowestComparableCandidate } from '../lib/candidateComparison';

const candidate = (skuId: string, price: number, currency: string) => ({ skuId, price, currency, name: skuId, symbol: '$', updatedAt: '2026-09-07T00:00:00Z' });

test('cross-currency model prices require valid FX and compare through EUR', () => {
  const values = [candidate('usd', 100, 'USD'), candidate('cad', 105, 'CAD')];
  assert.equal(lowestComparableCandidate(values, null), null);
  assert.equal(lowestComparableCandidate(values, { date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 1.2, CAD: 1.5 } })?.skuId, 'cad');
});

test('same-currency prices compare without FX', () => {
  assert.equal(lowestComparableCandidate([candidate('high', 110, 'USD'), candidate('low', 90, 'USD')], null)?.skuId, 'low');
});
