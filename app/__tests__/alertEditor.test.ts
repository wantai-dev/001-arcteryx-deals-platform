import assert from 'node:assert/strict';
import test from 'node:test';

import { initialAlertEditorValue, roundCurrencyAmount } from '../lib/alertEditor';
import { makeAlertPriceReference } from '../lib/alertPriceReference';

test('editing a saved USD target keeps its amount and currency when display currency changes to CNY', () => {
  const existing = { mode: 'custom' as const, targetAmount: 120, targetCurrency: 'USD', localEnabled: true, armed: true, rearmAbove: 122.4 };
  const value = initialAlertEditorValue(makeAlertPriceReference('live', 200, 'USD', '$'), 'CNY', existing, {
    date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 1.1, CNY: 8 },
  }, '2026-09-07T12:00:00Z');
  assert.deepEqual(value, { mode: 'custom', target: 120, currency: 'USD' });
});

test('10% presets round to the currency minor unit without discarding meaningful decimals', () => {
  assert.equal(initialAlertEditorValue(makeAlertPriceReference('live', 49.95, 'USD'), 'USD', undefined, null).target, 44.96);
  assert.equal(initialAlertEditorValue(makeAlertPriceReference('live', 0.5, 'USD'), 'USD', undefined, null).target, 0.45);
  assert.equal(initialAlertEditorValue(makeAlertPriceReference('live', 4995, 'JPY'), 'JPY', undefined, null).target, 4496);
  assert.equal(roundCurrencyAmount(10.005, 'USD'), 10.01);
});
