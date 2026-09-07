import { convertAmount, type RateSnapshot } from './currency';
import type { LocalPriceAlert } from './types';

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

export function initialAlertEditorValue(
  sourcePrice: number, sourceCurrency: string, displayedCurrency: string,
  existing: LocalPriceAlert | undefined, rates: RateSnapshot | null,
) {
  if (existing) return { mode: existing.mode, target: existing.targetAmount, currency: existing.targetCurrency };
  const converted = convertAmount(sourcePrice, sourceCurrency, displayedCurrency as never, rates);
  const usableCurrency = sourceCurrency === displayedCurrency || converted.converted ? displayedCurrency : sourceCurrency;
  const usablePrice = usableCurrency === displayedCurrency ? converted.value : sourcePrice;
  return { mode: 'percent10' as const, target: roundCurrencyAmount(usablePrice * 0.9, usableCurrency), currency: usableCurrency };
}
