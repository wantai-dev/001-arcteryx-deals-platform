import assert from 'node:assert/strict';
import test from 'node:test';

import { initialAlertEditorValue } from '../lib/alertEditor';

test('editing a saved USD target keeps its amount and currency when display currency changes to CNY', () => {
  const existing = { mode: 'custom' as const, targetAmount: 120, targetCurrency: 'USD', localEnabled: true, armed: true, rearmAbove: 122.4 };
  const value = initialAlertEditorValue(200, 'USD', 'CNY', existing, {
    date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 1.1, CNY: 8 },
  });
  assert.deepEqual(value, { mode: 'custom', target: 120, currency: 'USD' });
});
