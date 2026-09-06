import { convertAmount, type RateSnapshot } from './currency';
import type { LocalPriceAlert } from './types';

export function initialAlertEditorValue(
  sourcePrice: number, sourceCurrency: string, displayedCurrency: string,
  existing: LocalPriceAlert | undefined, rates: RateSnapshot | null,
) {
  if (existing) return { mode: existing.mode, target: existing.targetAmount, currency: existing.targetCurrency };
  const converted = convertAmount(sourcePrice, sourceCurrency, displayedCurrency as never, rates);
  const usableCurrency = sourceCurrency === displayedCurrency || converted.converted ? displayedCurrency : sourceCurrency;
  const usablePrice = usableCurrency === displayedCurrency ? converted.value : sourcePrice;
  return { mode: 'percent10' as const, target: Math.floor(usablePrice * 0.9), currency: usableCurrency };
}
