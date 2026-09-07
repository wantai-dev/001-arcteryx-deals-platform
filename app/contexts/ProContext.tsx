import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import { buildProPlanEntries, hasProEntitlement, ProPlan, ProPlanId } from '../lib/iap';

type PurchaseState = 'loading' | 'ready' | 'unavailable' | 'error';
type PurchaseOutcome = 'purchased' | 'restored' | 'cancelled' | 'pending' | 'not_found' | 'failed';
type OfferCodeOutcome = 'presented' | 'unavailable';
type PurchasesSdk = typeof import('react-native-purchases').default;

type ProContextValue = {
  isPro: boolean;
  managementURL: string | null;
  plans: ProPlan[];
  state: PurchaseState;
  busyPlan: ProPlanId | 'restore' | 'redeem' | null;
  error: string | null;
  purchase: (planId: ProPlanId) => Promise<PurchaseOutcome>;
  restore: () => Promise<PurchaseOutcome>;
  redeemOfferCode: () => Promise<OfferCodeOutcome>;
  refresh: () => Promise<void>;
};

const ProContext = createContext<ProContextValue | null>(null);
const revenueCatApiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();

export function ProProvider({ children }: PropsWithChildren) {
  const [isPro, setIsPro] = useState(false);
  const [managementURL, setManagementURL] = useState<string | null>(null);
  const [plans, setPlans] = useState<ProPlan[]>([]);
  const [state, setState] = useState<PurchaseState>('loading');
  const [busyPlan, setBusyPlan] = useState<ProPlanId | 'restore' | 'redeem' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sdkRef = useRef<PurchasesSdk | null>(null);
  const packagesRef = useRef(new Map<ProPlanId, PurchasesPackage>());

  const applyCustomerInfo = useCallback((customerInfo: CustomerInfo) => {
    setIsPro(hasProEntitlement(customerInfo));
    setManagementURL(customerInfo.managementURL);
  }, []);

  const load = useCallback(async (sdk: PurchasesSdk) => {
    const [customerInfoResult, offeringsResult] = await Promise.allSettled([
      sdk.getCustomerInfo(),
      sdk.getOfferings(),
    ]);
    if (customerInfoResult.status === 'fulfilled') {
      applyCustomerInfo(customerInfoResult.value);
    }

    if (offeringsResult.status === 'rejected') {
      packagesRef.current.clear();
      setPlans([]);
      setState('error');
      setError(errorMessage(offeringsResult.reason));
      return;
    }

    const offering = offeringsResult.value.current;
    if (!offering) {
      packagesRef.current.clear();
      setPlans([]);
      setState(customerInfoResult.status === 'rejected' ? 'error' : 'unavailable');
      setError(customerInfoResult.status === 'rejected'
        ? errorMessage(customerInfoResult.reason)
        : 'No current RevenueCat offering is configured.');
      return;
    }

    const productIds = offering.availablePackages.map((item) => item.product.identifier);
    const eligibility = productIds.length
      ? await sdk.checkTrialOrIntroductoryPriceEligibility(productIds).catch(() => ({}))
      : {};
    const entries = buildProPlanEntries(offering, eligibility);

    packagesRef.current = new Map(entries.map((entry) => [entry.plan.id, entry.purchasePackage]));
    setPlans(entries.map((entry) => entry.plan));
    setState(customerInfoResult.status === 'rejected' ? 'error' : entries.length ? 'ready' : 'unavailable');
    setError(customerInfoResult.status === 'rejected'
      ? errorMessage(customerInfoResult.reason)
      : entries.length ? null : 'The current offering does not contain GearDrop Pro products.');
  }, [applyCustomerInfo]);

  useEffect(() => {
    let active = true;
    let sdk: PurchasesSdk | null = null;
    let listener: ((customerInfo: CustomerInfo) => void) | null = null;

    async function initialize() {
      if (Platform.OS !== 'ios' || !revenueCatApiKey) {
        if (!active) return;
        setState('unavailable');
        setError(Platform.OS === 'ios' ? 'RevenueCat iOS API key is not configured.' : 'Apple purchases are only available on iOS.');
        return;
      }

      try {
        const module = await import('react-native-purchases');
        sdk = module.default;
        if (!(await sdk.isConfigured())) {
          sdk.configure({ apiKey: revenueCatApiKey });
        }
        sdkRef.current = sdk;
        listener = (customerInfo) => {
          if (active) applyCustomerInfo(customerInfo);
        };
        sdk.addCustomerInfoUpdateListener(listener);
        await load(sdk);
      } catch (nextError) {
        if (!active) return;
        setState('error');
        setError(errorMessage(nextError));
      }
    }

    void initialize();
    return () => {
      active = false;
      if (sdk && listener) sdk.removeCustomerInfoUpdateListener(listener);
    };
  }, [applyCustomerInfo, load]);

  const refresh = useCallback(async () => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    setState('loading');
    setError(null);
    try {
      await load(sdk);
    } catch (nextError) {
      setState('error');
      setError(errorMessage(nextError));
    }
  }, [load]);

  const purchase = useCallback(async (planId: ProPlanId): Promise<PurchaseOutcome> => {
    const sdk = sdkRef.current;
    const purchasePackage = packagesRef.current.get(planId);
    if (!sdk || !purchasePackage) return 'not_found';

    setBusyPlan(planId);
    setError(null);
    try {
      const result = await sdk.purchasePackage(purchasePackage);
      applyCustomerInfo(result.customerInfo);
      return hasProEntitlement(result.customerInfo) ? 'purchased' : 'not_found';
    } catch (nextError) {
      if (isRevenueCatError(nextError, sdk.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)) return 'cancelled';
      if (isRevenueCatError(nextError, sdk.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR)) return 'pending';
      setError(errorMessage(nextError));
      return 'not_found';
    } finally {
      setBusyPlan(null);
    }
  }, [applyCustomerInfo]);

  const restore = useCallback(async (): Promise<PurchaseOutcome> => {
    const sdk = sdkRef.current;
    if (!sdk) return 'failed';

    setBusyPlan('restore');
    setError(null);
    try {
      const customerInfo = await sdk.restorePurchases();
      applyCustomerInfo(customerInfo);
      return hasProEntitlement(customerInfo) ? 'restored' : 'not_found';
    } catch (nextError) {
      setError(errorMessage(nextError));
      return 'failed';
    } finally {
      setBusyPlan(null);
    }
  }, [applyCustomerInfo]);

  const redeemOfferCode = useCallback(async (): Promise<OfferCodeOutcome> => {
    const sdk = sdkRef.current;
    if (Platform.OS !== 'ios' || !sdk) return 'unavailable';

    setBusyPlan('redeem');
    setError(null);
    try {
      await sdk.presentCodeRedemptionSheet();
      return 'presented';
    } catch (nextError) {
      setError(errorMessage(nextError));
      return 'unavailable';
    } finally {
      setBusyPlan(null);
    }
  }, []);

  const value = useMemo(
    () => ({ isPro, managementURL, plans, state, busyPlan, error, purchase, restore, redeemOfferCode, refresh }),
    [isPro, managementURL, plans, state, busyPlan, error, purchase, restore, redeemOfferCode, refresh],
  );
  return <ProContext.Provider value={value}>{children}</ProContext.Provider>;
}

export function usePro() {
  const value = useContext(ProContext);
  if (!value) throw new Error('usePro must be used inside ProProvider');
  return value;
}

function isRevenueCatError(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && String(error.code) === code);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Apple purchase service is unavailable.';
}
