import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailAlertSyncError, saveAlertAndSyncEmail } from '../lib/emailAlertSync';
import type { AlertDraft } from '../lib/watchlist';

const draft: AlertDraft = { mode: 'custom', targetAmount: 700, targetCurrency: 'CNY', localEnabled: true, email: ' Shopper@Example.com ' };
const rates = { date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 1, CNY: 7 } };

test('SKU edits upsert the email target in the original price currency after local acceptance', async () => {
  const events: unknown[] = [];
  const accepted = await saveAlertAndSyncEmail(draft, {
    skuId: 'merchant:products/one', sourceCurrency: 'USD', rates,
    saveLocal: async () => { events.push('local'); return true; },
    registerEmail: async (request) => { events.push(request); },
    clearUnconfirmedEmail: async () => { throw new Error('unexpected cleanup'); },
  });
  assert.equal(accepted, true);
  assert.deepEqual(events, ['local', { sku_id: 'merchant:products/one', email: 'shopper@example.com', target_price: 100 }]);
});

test('quota rejection never registers a remote email subscription', async () => {
  assert.equal(await saveAlertAndSyncEmail(draft, {
    skuId: 'sku', sourceCurrency: 'USD', rates,
    saveLocal: async () => false,
    registerEmail: async () => { throw new Error('unexpected network'); },
    clearUnconfirmedEmail: async () => { throw new Error('unexpected cleanup'); },
  }), false);
});

test('missing FX and rejected registration clear only the unconfirmed email through the guarded callback', async () => {
  for (const missingRates of [true, false]) {
    let cleaned = 0;
    await assert.rejects(saveAlertAndSyncEmail(draft, {
      skuId: 'sku', sourceCurrency: 'USD', rates: missingRates ? null : rates,
      saveLocal: async () => true,
      registerEmail: async () => { assert.equal(missingRates, false); throw new Error('service unavailable'); },
      clearUnconfirmedEmail: async (failedDraft) => { assert.equal(failedDraft, draft); cleaned += 1; },
    }), (error) => error instanceof EmailAlertSyncError && error.localStateSaved);
    assert.equal(cleaned, 1);
  }
});

test('failed cleanup never claims local settings were saved consistently', async () => {
  await assert.rejects(saveAlertAndSyncEmail(draft, {
    skuId: 'sku', sourceCurrency: 'USD', rates: null,
    saveLocal: async () => true,
    registerEmail: async () => undefined,
    clearUnconfirmedEmail: async () => { throw new Error('storage unavailable'); },
  }), (error) => error instanceof EmailAlertSyncError && !error.localStateSaved);
});
