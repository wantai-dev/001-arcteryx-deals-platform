import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProPlanEntries,
  hasProEntitlement,
  loadProResources,
  PackageLike,
  purchaseConcern,
  purchaseProPackage,
  resolveRestoreFeedback,
  PRO_PRODUCT_IDS,
  restoreProPurchase,
} from '../lib/iap';

const errorCodes = {
  PURCHASE_CANCELLED_ERROR: '1', STORE_PROBLEM_ERROR: '2', PURCHASE_NOT_ALLOWED_ERROR: '3',
  NETWORK_ERROR: '10', INSUFFICIENT_PERMISSIONS_ERROR: '19', PAYMENT_PENDING_ERROR: '20',
  PRODUCT_REQUEST_TIMED_OUT_ERROR: '32', OFFLINE_CONNECTION_ERROR: '35',
};

function makePackage(
  productId: string,
  price: string,
  options: { monthly?: string; trial?: string; trialUnit?: string; trialUnits?: number } = {},
): PackageLike {
  return {
    identifier: productId,
    product: {
      identifier: productId,
      priceString: price,
      pricePerMonthString: options.monthly || null,
      introPrice: options.trial ? {
        price: 0,
        period: options.trial,
        periodUnit: options.trialUnit,
        periodNumberOfUnits: options.trialUnits,
      } : null,
    },
  };
}

test('hasProEntitlement only grants access for the active Pro entitlement', () => {
  assert.equal(hasProEntitlement({ entitlements: { active: {} } }), false);
  assert.equal(hasProEntitlement({ entitlements: { active: { Pro: { productIdentifier: PRO_PRODUCT_IDS.annual } } } }), true);
  assert.equal(hasProEntitlement({ entitlements: { active: { pro: { productIdentifier: PRO_PRODUCT_IDS.annual } } } }), false);
});

test('loadProResources applies a successful Pro entitlement when offerings fail', async () => {
  const customerInfo = { entitlements: { active: { Pro: { productIdentifier: PRO_PRODUCT_IDS.annual } } } };
  let applied = false;
  const result = await loadProResources(
    async () => customerInfo,
    async () => { throw new Error('offerings unavailable'); },
    (next) => { applied = hasProEntitlement(next); },
  );

  assert.equal(applied, true);
  assert.equal(result.customerInfoResult.status, 'fulfilled');
  assert.equal(result.offeringsResult.status, 'rejected');
});

test('restoreProPurchase distinguishes service failure from a successful empty restore', async () => {
  const failed = await restoreProPurchase(async () => {
    throw new Error('offline');
  });
  const empty = await restoreProPurchase(async () => ({ entitlements: { active: {} } }));

  assert.equal(failed.outcome, 'failed');
  assert.equal(empty.outcome, 'not_found');
});

test('purchaseProPackage keeps processed-but-unsynced transactions distinct from a purchase', async () => {
  const outcomes: string[] = [];
  const result = await purchaseProPackage(
    async () => ({ customerInfo: { entitlements: { active: {} } } }),
    (info) => outcomes.push(hasProEntitlement(info) ? 'pro' : 'free'),
    errorCodes,
  );
  assert.deepEqual(result, { outcome: 'missing_entitlement' });
  assert.deepEqual(outcomes, ['free']);
  assert.deepEqual(purchaseConcern(result), { outcome: 'missing_entitlement' });
});

test('purchaseProPackage returns sanitized outcomes and codes for known SDK errors only', async () => {
  const fail = (error: unknown) => purchaseProPackage(async () => { throw error; }, () => undefined, errorCodes);
  assert.deepEqual(await fail({ code: '1', message: 'private' }), { outcome: 'cancelled', code: '1' });
  assert.deepEqual(await fail({ code: 20, userInfo: { receipt: 'private' } }), { outcome: 'pending', code: '20' });
  assert.deepEqual(await fail({ code: '10' }), { outcome: 'network_error', code: '10' });
  assert.deepEqual(await fail({ code: '2' }), { outcome: 'store_unavailable', code: '2' });
  assert.deepEqual(await fail({ code: '3' }), { outcome: 'purchase_restricted', code: '3' });
  assert.deepEqual(await fail({ code: '11', message: 'credential detail' }), { outcome: 'failed' });
  assert.deepEqual(await fail(new Error('raw detail')), { outcome: 'failed' });
});

test('payment preflight blocks disallowed devices without calling StoreKit', async () => {
  let calls = 0;
  const result = await purchaseProPackage(
    async () => { calls += 1; return { customerInfo: { entitlements: { active: {} } } }; },
    () => undefined,
    errorCodes,
    async () => false,
  );
  assert.deepEqual(result, { outcome: 'purchase_restricted' });
  assert.equal(calls, 0);
});

test('restore feedback clears the purchase concern only after a confirmed entitlement', () => {
  const concern = { outcome: 'store_unavailable', code: '2' } as const;
  assert.deepEqual(resolveRestoreFeedback(concern, 'not_found'), { concern, notice: 'store_unavailable' });
  assert.deepEqual(resolveRestoreFeedback(concern, 'restored'), { concern: null, notice: 'restored' });
});

test('buildProPlanEntries converts a StoreKit one-week trial to seven days', () => {
  const annual = makePackage(PRO_PRODUCT_IDS.annual, 'US$23.99', {
    trial: 'P1W',
    trialUnit: 'WEEK',
    trialUnits: 1,
  });

  const entries = buildProPlanEntries(
    { monthly: null, annual, lifetime: null, availablePackages: [annual] },
    { [PRO_PRODUCT_IDS.annual]: { status: 2 } },
  );

  assert.equal(entries[0]?.plan.trialDays, 7);
});

test('buildProPlanEntries maps expected products and keeps StoreKit-localized prices', () => {
  const monthly = makePackage(PRO_PRODUCT_IDS.monthly, 'US$3.99');
  const annual = makePackage(PRO_PRODUCT_IDS.annual, 'US$23.99', { monthly: 'US$2.00', trial: 'P7D' });
  const lifetime = makePackage(PRO_PRODUCT_IDS.lifetime, 'US$49.99');

  const entries = buildProPlanEntries(
    { monthly, annual, lifetime, availablePackages: [monthly, annual, lifetime] },
    { [PRO_PRODUCT_IDS.annual]: { status: 2 } },
  );

  assert.deepEqual(entries.map(({ plan }) => plan), [
    { id: 'monthly', productId: PRO_PRODUCT_IDS.monthly, price: 'US$3.99', pricePerMonth: null, trialDays: null },
    { id: 'annual', productId: PRO_PRODUCT_IDS.annual, price: 'US$23.99', pricePerMonth: 'US$2.00', trialDays: 7 },
    { id: 'lifetime', productId: PRO_PRODUCT_IDS.lifetime, price: 'US$49.99', pricePerMonth: null, trialDays: null },
  ]);
});

test('buildProPlanEntries ignores unrelated products and does not advertise unknown trial eligibility', () => {
  const annual = makePackage(PRO_PRODUCT_IDS.annual, '€23.99', { trial: 'P7D' });
  const unrelated = makePackage('example.unrelated', '€1.00');

  const entries = buildProPlanEntries(
    { monthly: unrelated, annual: null, lifetime: null, availablePackages: [unrelated, annual] },
    { [PRO_PRODUCT_IDS.annual]: { status: 0 } },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.plan.id, 'annual');
  assert.equal(entries[0]?.plan.trialDays, null);
});
