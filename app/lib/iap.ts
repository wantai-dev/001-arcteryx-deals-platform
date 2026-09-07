export const PRO_ENTITLEMENT_ID = 'Pro';

export const PRO_PRODUCT_IDS = {
  monthly: 'dev.100app.geardrop.pro.monthly',
  annual: 'dev.100app.geardrop.pro.annual',
  lifetime: 'dev.100app.geardrop.pro.lifetime',
} as const;

export type ProPlanId = keyof typeof PRO_PRODUCT_IDS;

export type ProPlan = {
  id: ProPlanId;
  productId: string;
  price: string;
  pricePerMonth: string | null;
  trialDays: number | null;
};

export type ProPurchaseOutcome =
  | 'purchased'
  | 'cancelled'
  | 'pending'
  | 'missing_entitlement'
  | 'network_error'
  | 'store_unavailable'
  | 'purchase_restricted'
  | 'unavailable'
  | 'failed';

export type ProPurchaseResult = { outcome: ProPurchaseOutcome; code?: string };
export type ProRestoreOutcome = 'restored' | 'not_found' | 'failed';

export type RevenueCatPurchaseErrorCodes = Record<string, string> & {
  PURCHASE_CANCELLED_ERROR: string;
  STORE_PROBLEM_ERROR: string;
  PURCHASE_NOT_ALLOWED_ERROR: string;
  NETWORK_ERROR: string;
  INSUFFICIENT_PERMISSIONS_ERROR: string;
  PAYMENT_PENDING_ERROR: string;
  PRODUCT_REQUEST_TIMED_OUT_ERROR: string;
  OFFLINE_CONNECTION_ERROR: string;
};

type ProductLike = {
  identifier: string;
  priceString: string;
  pricePerMonthString: string | null;
  introPrice: {
    price: number;
    period: string;
    periodUnit?: string;
    periodNumberOfUnits?: number;
  } | null;
};

export type PackageLike = {
  identifier: string;
  product: ProductLike;
};

type OfferingLike<TPackage extends PackageLike> = {
  monthly: TPackage | null;
  annual: TPackage | null;
  lifetime: TPackage | null;
  availablePackages: TPackage[];
};

type IntroEligibilityLike = {
  status: number;
};

export type CustomerInfoLike = {
  entitlements: {
    active: Record<string, unknown>;
  };
};

export async function loadProResources<TCustomer extends CustomerInfoLike, TOfferings>(
  getCustomerInfo: () => Promise<TCustomer>,
  getOfferings: () => Promise<TOfferings>,
  applyCustomerInfo: (customerInfo: TCustomer) => void,
) {
  const [customerInfoResult, offeringsResult] = await Promise.allSettled([
    getCustomerInfo(),
    getOfferings(),
  ]);
  if (customerInfoResult.status === 'fulfilled') {
    applyCustomerInfo(customerInfoResult.value);
  }
  return { customerInfoResult, offeringsResult };
}

export type RestoreProPurchaseResult<TCustomer extends CustomerInfoLike> =
  | { outcome: 'restored' | 'not_found'; customerInfo: TCustomer }
  | { outcome: 'failed'; error: unknown };

export async function restoreProPurchase<TCustomer extends CustomerInfoLike>(
  restorePurchases: () => Promise<TCustomer>,
): Promise<RestoreProPurchaseResult<TCustomer>> {
  try {
    const customerInfo = await restorePurchases();
    return {
      outcome: hasProEntitlement(customerInfo) ? 'restored' : 'not_found',
      customerInfo,
    };
  } catch (error) {
    return { outcome: 'failed', error };
  }
}

export async function purchaseProPackage<TCustomer extends CustomerInfoLike>(
  purchasePackage: () => Promise<{ customerInfo: TCustomer }>,
  applyCustomerInfo: (customerInfo: TCustomer) => void,
  errorCodes: RevenueCatPurchaseErrorCodes,
  canMakePayments?: () => Promise<boolean>,
): Promise<ProPurchaseResult> {
  if (canMakePayments) {
    try {
      if (!(await canMakePayments())) return { outcome: 'purchase_restricted' };
    } catch {
      // Let the purchase call return the authoritative store error.
    }
  }
  try {
    const { customerInfo } = await purchasePackage();
    applyCustomerInfo(customerInfo);
    return { outcome: hasProEntitlement(customerInfo) ? 'purchased' : 'missing_entitlement' };
  } catch (error) {
    return classifyPurchaseError(error, errorCodes);
  }
}

export function classifyPurchaseError(error: unknown, errorCodes: RevenueCatPurchaseErrorCodes): ProPurchaseResult {
  const code = safePurchaseErrorCode(error, errorCodes);
  if (code === errorCodes.PURCHASE_CANCELLED_ERROR) return { outcome: 'cancelled', code };
  if (code === errorCodes.PAYMENT_PENDING_ERROR) return { outcome: 'pending', code };
  if (code === errorCodes.NETWORK_ERROR || code === errorCodes.OFFLINE_CONNECTION_ERROR || code === errorCodes.PRODUCT_REQUEST_TIMED_OUT_ERROR) return { outcome: 'network_error', code };
  if (code === errorCodes.STORE_PROBLEM_ERROR) return { outcome: 'store_unavailable', code };
  if (code === errorCodes.PURCHASE_NOT_ALLOWED_ERROR || code === errorCodes.INSUFFICIENT_PERMISSIONS_ERROR) return { outcome: 'purchase_restricted', code };
  return code ? { outcome: 'failed', code } : { outcome: 'failed' };
}

function safePurchaseErrorCode(error: unknown, errorCodes: RevenueCatPurchaseErrorCodes): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = error.code;
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const normalized = String(code);
  return Object.values(errorCodes).includes(normalized) ? normalized : null;
}

export type ProPurchaseConcern = Extract<ProPurchaseOutcome, 'pending' | 'missing_entitlement' | 'store_unavailable'>;
export type ProPurchaseConcernResult = ProPurchaseResult & { outcome: ProPurchaseConcern };

export function purchaseConcern(result: ProPurchaseResult): ProPurchaseConcernResult | null {
  return result.outcome === 'pending' || result.outcome === 'missing_entitlement' || result.outcome === 'store_unavailable'
    ? result as ProPurchaseConcernResult : null;
}

export function resolveRestoreFeedback(concern: ProPurchaseConcernResult | null, restoreOutcome: ProRestoreOutcome): {
  concern: ProPurchaseConcernResult | null;
  notice: ProRestoreOutcome | ProPurchaseConcern;
} {
  if (restoreOutcome === 'restored') return { concern: null, notice: 'restored' };
  if (concern) return { concern, notice: concern.outcome };
  return { concern: null, notice: restoreOutcome };
}

export type ProPlanEntry<TPackage extends PackageLike> = {
  plan: ProPlan;
  purchasePackage: TPackage;
};

const PLAN_ORDER: ProPlanId[] = ['monthly', 'annual', 'lifetime'];
const INTRO_ELIGIBLE = 2;

export function hasProEntitlement(customerInfo: CustomerInfoLike) {
  return Boolean(customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]);
}

export function buildProPlanEntries<TPackage extends PackageLike>(
  offering: OfferingLike<TPackage>,
  eligibility: Record<string, IntroEligibilityLike> = {},
): ProPlanEntry<TPackage>[] {
  return PLAN_ORDER.flatMap((id) => {
    const expectedProductId = PRO_PRODUCT_IDS[id];
    const standardPackage = offering[id];
    const purchasePackage = standardPackage?.product.identifier === expectedProductId
      ? standardPackage
      : offering.availablePackages.find((candidate) => candidate.product.identifier === expectedProductId);

    if (!purchasePackage) return [];

    const intro = purchasePackage.product.introPrice;
    const trialDays = eligibility[expectedProductId]?.status === INTRO_ELIGIBLE && intro?.price === 0
      ? trialDurationDays(intro)
      : null;

    return [{
      plan: {
        id,
        productId: expectedProductId,
        price: purchasePackage.product.priceString,
        pricePerMonth: purchasePackage.product.pricePerMonthString,
        trialDays,
      },
      purchasePackage,
    }];
  });
}

function trialDurationDays(intro: NonNullable<ProductLike['introPrice']>) {
  const units = intro.periodNumberOfUnits;
  if (Number.isInteger(units) && units && units > 0) {
    if (intro.periodUnit === 'DAY') return units;
    if (intro.periodUnit === 'WEEK') return units * 7;
  }

  const match = /^P(\d+)([DW])$/.exec(intro.period);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'W' ? amount * 7 : amount;
}
