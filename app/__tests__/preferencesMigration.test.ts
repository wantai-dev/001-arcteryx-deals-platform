import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreferencePatches, DEFAULT_PREFERENCES, migratePreferences, updatePreferences } from '../lib/preferences';

test('new installs receive the stable market and appearance defaults', () => {
  assert.deepEqual(migratePreferences(null, null, null), DEFAULT_PREFERENCES);
});

test('writes made before hydration replay in order over migrated values', () => {
  const migrated = migratePreferences(null, JSON.stringify({ language: 'de', currency: 'EUR' }), 'de');
  assert.deepEqual(applyPreferencePatches(migrated, [{ appearance: 'dark' }, { currency: 'CNY' }, { notificationsEnabled: true }]), {
    language: 'de', currency: 'CNY', region: 'de', appearance: 'dark', notificationsEnabled: true,
  });
});

test('v1 language and currency migrate atomically with the legacy region', () => {
  assert.deepEqual(migratePreferences(null, JSON.stringify({ language: 'de', currency: 'CHF' }), 'ch'), {
    language: 'de', currency: 'CHF', region: 'ch', appearance: 'system', notificationsEnabled: false,
  });
});

test('v2 wins over stale legacy keys and preserves CNY and notification choices', () => {
  const v2 = { language: 'zh-Hans', currency: 'CNY', region: 'ca', appearance: 'dark', notificationsEnabled: true } as const;
  assert.deepEqual(migratePreferences(JSON.stringify(v2), JSON.stringify({ currency: 'USD' }), 'us'), v2);
});

test('invalid stored values fail closed while sequential patches retain unrelated fields', () => {
  const invalid = migratePreferences(JSON.stringify({ language: 'xx', currency: 'BTC', region: 'jp', appearance: 'neon', notificationsEnabled: 'yes' }), null, null);
  assert.deepEqual(invalid, DEFAULT_PREFERENCES);
  const market = updatePreferences(DEFAULT_PREFERENCES, { region: 'gb', currency: 'GBP' });
  assert.deepEqual(updatePreferences(market, { appearance: 'light' }), { ...DEFAULT_PREFERENCES, region: 'gb', currency: 'GBP', appearance: 'light' });
});
