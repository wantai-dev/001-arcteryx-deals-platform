import { convertAmount, type RateSnapshot } from './currency';
import type { PriceCandidate } from './priceMonitor';

export function lowestComparableCandidate(candidates: PriceCandidate[], rates: RateSnapshot | null) {
  if (!candidates.length) return null;
  const currencies = new Set(candidates.map((candidate) => candidate.currency));
  if (currencies.size === 1) return [...candidates].sort((a, b) => a.price - b.price || a.skuId.localeCompare(b.skuId))[0] || null;
  if (!rates) return null;
  const converted = candidates.map((candidate) => ({
    candidate,
    value: convertAmount(candidate.price, candidate.currency, 'EUR', rates),
  }));
  if (converted.some((item) => !item.value.converted || !Number.isFinite(item.value.value) || item.value.value <= 0)) return null;
  return converted.sort((a, b) => a.value.value - b.value.value || a.candidate.skuId.localeCompare(b.candidate.skuId))[0]?.candidate || null;
}
