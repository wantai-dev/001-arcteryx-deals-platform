import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProPlanEntries, hasProEntitlement, PackageLike, PRO_PRODUCT_IDS } from '../lib/iap';

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
