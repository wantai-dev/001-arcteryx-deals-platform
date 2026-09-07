import { lowestComparableCandidate } from './candidateComparison';
import { convertAmount, RATE_QUOTES, type RateSnapshot } from './currency';
import { productsToPriceCandidates } from './priceCandidateMapper';
import { MAX_RATE_AGE_MS, type PriceCandidate } from './priceMonitor';
import type { CatalogProduct, LocalPriceAlert, Product, WatchEntry } from './types';

export type AlertPriceReferenceKind = 'live' | 'catalog' | 'saved';

export type AlertPriceReference =
  | { kind: AlertPriceReferenceKind; amount: number; currency: string; symbol: string }
  | { kind: 'unavailable'; currency?: string };

const ALERT_CURRENCIES = new Set<string>(['EUR', ...RATE_QUOTES]);

function validCurrency(value: string | null | undefined): value is string {
  return typeof value === 'string' && ALERT_CURRENCIES.has(value);
}

export function makeAlertPriceReference(
  kind: AlertPriceReferenceKind,
  amount: number,
  currency: string | null | undefined,
  symbol = '',
): AlertPriceReference {
  if (!validCurrency(currency) || !Number.isFinite(amount) || amount <= 0) {
    return { kind: 'unavailable', ...(validCurrency(currency) ? { currency } : {}) };
  }
  return { kind, amount, currency, symbol };
}

export function alertPriceReferenceForProduct(
  product: Product,
  rates: RateSnapshot | null,
  nowIso = new Date().toISOString(),
): AlertPriceReference {
  const candidate = lowestComparableCandidate(productsToPriceCandidates([product]), rates, nowIso);
  return candidate
    ? makeAlertPriceReference('live', candidate.price, candidate.currency, candidate.symbol)
    : { kind: 'unavailable', ...(validCurrency(product.currency) ? { currency: product.currency } : {}) };
}

export function alertPriceReferenceForCatalog(product: CatalogProduct): AlertPriceReference {
  return makeAlertPriceReference('catalog', product.list_price, product.currency, product.currency);
}

export function watchAlertPriceReference(
  entry: WatchEntry,
  currentCandidate?: PriceCandidate | null,
): AlertPriceReference {
  let knownCurrency: string | undefined;
  if (currentCandidate) {
    const live = makeAlertPriceReference(
      'live', currentCandidate.price, currentCandidate.currency, currentCandidate.symbol,
    );
    if (live.kind !== 'unavailable') return live;
    knownCurrency = live.currency;
  }
  if (entry.savedMoney) {
    const saved = makeAlertPriceReference(
      'saved', entry.savedMoney.amount, entry.savedMoney.currency,
      entry.snapshot?.symbol || entry.symbol,
    );
    if (saved.kind !== 'unavailable') return saved;
    knownCurrency ||= saved.currency;
  }
  if (entry.snapshot) {
    const saved = makeAlertPriceReference(
      'saved', entry.snapshot.price, entry.snapshot.currency, entry.snapshot.symbol,
    );
    if (saved.kind !== 'unavailable') return saved;
    knownCurrency ||= saved.currency;
  }
  return { kind: 'unavailable', ...(knownCurrency ? { currency: knownCurrency } : {}) };
}

export function convertAlertPriceReference(
  reference: AlertPriceReference,
  targetCurrency: string,
  rates: RateSnapshot | null,
  nowIso = new Date().toISOString(),
): number | null {
  if (reference.kind === 'unavailable' || !validCurrency(targetCurrency)) return null;
  if (reference.currency === targetCurrency) return reference.amount;
  const nowMs = Date.parse(nowIso);
  const fetchedAt = Date.parse(rates?.fetchedAt || '');
  if (!Number.isFinite(nowMs) || !Number.isFinite(fetchedAt)
    || fetchedAt > nowMs + 5 * 60 * 1000 || nowMs - fetchedAt > MAX_RATE_AGE_MS) return null;
  const converted = convertAmount(reference.amount, reference.currency, targetCurrency as never, rates);
  return converted.converted && converted.currency === targetCurrency
    && Number.isFinite(converted.value) && converted.value > 0 ? converted.value : null;
}

export function initialAlertEditorValue(
  reference: AlertPriceReference,
  displayedCurrency: string,
  existing: LocalPriceAlert | undefined,
  rates: RateSnapshot | null,
  nowIso = new Date().toISOString(),
) {
  if (existing) {
    const comparable = convertAlertPriceReference(reference, existing.targetCurrency, rates, nowIso) !== null;
    return {
      mode: comparable ? existing.mode : 'custom' as const,
      target: existing.targetAmount,
      currency: existing.targetCurrency,
    };
  }
  const referenceCurrency = reference.currency;
  const preferredCurrency = validCurrency(displayedCurrency) ? displayedCurrency : referenceCurrency;
  if (reference.kind !== 'unavailable' && preferredCurrency) {
    const amount = convertAlertPriceReference(reference, preferredCurrency, rates, nowIso);
    if (amount !== null) {
      return {
        mode: 'percent10' as const,
        target: roundCurrencyAmount(amount * 0.9, preferredCurrency),
        currency: preferredCurrency,
      };
    }
  }
  return { mode: 'custom' as const, target: '' as const, currency: referenceCurrency || '' };
}

export function roundCurrencyAmount(value: number, currency: string) {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unknown currencies use the common two-decimal fallback.
  }
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function validAlertTargetCurrency(value: string) {
  return validCurrency(value);
}

export function shouldInitializeAlertEditor(
  initializedSession: string | null,
  visible: boolean,
  sessionKey: string,
) {
  return visible && initializedSession !== sessionKey;
}
