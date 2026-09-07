import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreferencePatches, createPreferenceStore, DEFAULT_PREFERENCES, migratePreferences, preferenceRateStatus, PREFERENCES_V1_KEY, PREFERENCES_V2_KEY, rateSnapshotNeedsRefresh, REGION_V1_KEY, updatePreferences } from '../lib/preferences';

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

test('the legacy all-regions choice survives migration and normalization', () => {
  assert.equal(migratePreferences(null, null, 'all').region, 'all');
  assert.equal(migratePreferences(JSON.stringify({ region: 'ALL' }), null, null).region, 'all');
});

test('cached and live rate status remains accurate after leaving original currency', () => {
  const snapshot = {
    date: '2026-09-07',
    fetchedAt: '2026-09-07T00:00:00.000Z',
    rates: { EUR: 1, CNY: 8.3 },
  };
  assert.equal(preferenceRateStatus('original', snapshot, 'cached', false), 'original');
  assert.equal(preferenceRateStatus('CNY', snapshot, 'cached', false), 'cached');
  assert.equal(preferenceRateStatus('CNY', snapshot, 'live', false), 'live');
  assert.equal(preferenceRateStatus('CNY', null, 'none', true), 'loading');
  assert.equal(preferenceRateStatus('CNY', null, 'none', false), 'unavailable');
  assert.equal(rateSnapshotNeedsRefresh(null, Date.parse('2026-09-07T12:00:00.000Z')), true);
  assert.equal(rateSnapshotNeedsRefresh(snapshot, Date.parse('2026-09-07T12:00:00.000Z')), false);
  assert.equal(rateSnapshotNeedsRefresh(snapshot, Date.parse('2026-09-08T00:00:00.001Z')), true);
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

test('malformed v2 falls back to valid legacy preferences', () => {
  assert.deepEqual(migratePreferences('{bad json', JSON.stringify({ language: 'fr', currency: 'EUR' }), 'fr'), {
    ...DEFAULT_PREFERENCES, language: 'fr', currency: 'EUR', region: 'fr',
  });
});

test('store waits for hydration and publishes only after serialized writes succeed', async () => {
  const values = new Map<string, string>([
    [PREFERENCES_V1_KEY, JSON.stringify({ language: 'de', currency: 'EUR' })],
    [REGION_V1_KEY, 'de'],
  ]);
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const storage = {
    async getItem(key: string) { await readGate; return values.get(key) ?? null; },
    async setItem(key: string, value: string) { await new Promise((resolve) => setTimeout(resolve, 2)); values.set(key, value); },
  };
  const store = createPreferenceStore(storage);
  const published: string[] = [];
  store.subscribe((value) => published.push(`${value.region}:${value.currency}`));
  const first = store.update({ region: 'ca', currency: 'CAD' });
  const second = store.update({ appearance: 'dark' });
  assert.equal(store.getSnapshot().hydrated, false);
  assert.deepEqual(published, []);
  releaseRead();
  await Promise.all([first, second]);
  assert.deepEqual(store.getSnapshot(), {
    hydrated: true,
    preferences: { language: 'de', currency: 'CAD', region: 'ca', appearance: 'dark', notificationsEnabled: false },
  });
  assert.equal(JSON.parse(values.get(PREFERENCES_V2_KEY)!).appearance, 'dark');
});

test('read and write failures do not publish defaults or failed changes and can be retried', async () => {
  let failRead = true;
  let failWrite = false;
  const values = new Map<string, string>([[PREFERENCES_V1_KEY, JSON.stringify({ currency: 'GBP' })]]);
  const storage = {
    async getItem(key: string) { if (failRead) throw new Error('read failed'); return values.get(key) ?? null; },
    async setItem(key: string, value: string) { if (failWrite) throw new Error('write failed'); values.set(key, value); },
  };
  const store = createPreferenceStore(storage);
  let publications = 0;
  store.subscribe(() => { publications += 1; });
  await assert.rejects(store.hydrate(), /read failed/);
  assert.deepEqual(store.getSnapshot(), { preferences: DEFAULT_PREFERENCES, hydrated: false });
  assert.equal(publications, 0);
  failRead = false;
  await store.hydrate();
  assert.equal(store.getSnapshot().preferences.currency, 'GBP');
  failWrite = true;
  await assert.rejects(store.update({ currency: 'CNY' }), /write failed/);
  assert.equal(store.getSnapshot().preferences.currency, 'GBP');
  assert.equal(publications, 1);
});
