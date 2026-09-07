import { convertAmount, type RateSnapshot } from './currency';
import { MAX_PRODUCT_AGE_MS, MAX_RATE_AGE_MS, type PriceCandidate } from './priceMonitor';

function fresh(value: string, nowMs: number, maxAgeMs: number) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && stamp <= nowMs + 5 * 60 * 1000 && nowMs - stamp <= maxAgeMs;
}

export function lowestComparableCandidate(
  candidates: PriceCandidate[], rates: RateSnapshot | null, nowIso = new Date().toISOString(),
) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  const valid = candidates.filter((candidate) => Number.isFinite(candidate.price) && candidate.price > 0
    && /^[A-Z]{3}$/.test(candidate.currency) && fresh(candidate.updatedAt, nowMs, MAX_PRODUCT_AGE_MS));
  if (!valid.length) return null;
  const currencies = new Set(valid.map((candidate) => candidate.currency));
  if (currencies.size === 1) return [...valid].sort((a, b) => a.price - b.price || a.skuId.localeCompare(b.skuId))[0] || null;
  if (!rates || !fresh(rates.fetchedAt, nowMs, MAX_RATE_AGE_MS)) return null;
  const converted = valid.map((candidate) => ({
    candidate,
    value: convertAmount(candidate.price, candidate.currency, 'EUR', rates),
  }));
  if (converted.some((item) => item.value.currency !== 'EUR'
    || (!item.value.converted && item.candidate.currency !== 'EUR')
    || !Number.isFinite(item.value.value) || item.value.value <= 0)) return null;
  return converted.sort((a, b) => a.value.value - b.value.value || a.candidate.skuId.localeCompare(b.candidate.skuId))[0]?.candidate || null;
}
