import { convertAmount, type RateSnapshot } from './currency';
import type { WatchEntry } from './types';

export const MAX_PRODUCT_AGE_MS = 72 * 60 * 60 * 1000;
export const MAX_RATE_AGE_MS = 36 * 60 * 60 * 1000;

export type PriceCandidate = {
  skuId: string;
  modelKey?: string | null;
  name: string;
  price: number;
  currency: string;
  symbol: string;
  updatedAt: string;
};

export type PriceAlertEvent = {
  entryId: string;
  skuId: string;
  name: string;
  price: number;
  currency: string;
  symbol: string;
};

export type PriceMonitorResult = {
  entries: WatchEntry[];
  events: PriceAlertEvent[];
  skippedStaleProducts: number;
  skippedFx: number;
};

function freshTimestamp(value: string, nowMs: number, maxAgeMs: number) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs + 5 * 60 * 1000 && nowMs - parsed <= maxAgeMs;
}

function convertedCandidate(
  candidate: PriceCandidate, targetCurrency: string, rates: RateSnapshot | null, nowMs: number,
) {
  if (candidate.currency === targetCurrency) return candidate.price;
  if (!rates || !freshTimestamp(rates.fetchedAt, nowMs, MAX_RATE_AGE_MS)) return null;
  const converted = convertAmount(candidate.price, candidate.currency, targetCurrency as never, rates);
  return converted.converted && converted.currency === targetCurrency ? converted.value : null;
}

export function evaluatePriceAlerts(
  entries: WatchEntry[], candidates: PriceCandidate[], rates: RateSnapshot | null,
  nowIso = new Date().toISOString(),
): PriceMonitorResult {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) throw new Error('Price monitor requires a valid timestamp.');
  let skippedStaleProducts = 0;
  let skippedFx = 0;
  const events: PriceAlertEvent[] = [];
  const nextEntries = entries.map((entry) => {
    const alert = entry.alert;
    if (!entry.id || !alert?.localEnabled) return entry;
    const matches = candidates.filter((candidate) => (
      entry.scope === 'model'
        ? Boolean(entry.modelKey && candidate.modelKey === entry.modelKey)
        : candidate.skuId === entry.skuId
    ));
    const comparable: Array<{ candidate: PriceCandidate; converted: number }> = [];
    for (const candidate of matches) {
      if (!Number.isFinite(candidate.price) || candidate.price <= 0
        || !freshTimestamp(candidate.updatedAt, nowMs, MAX_PRODUCT_AGE_MS)) {
        skippedStaleProducts += 1;
        continue;
      }
      const converted = convertedCandidate(candidate, alert.targetCurrency, rates, nowMs);
      if (converted === null) {
        skippedFx += 1;
        continue;
      }
      comparable.push({ candidate, converted });
    }
    comparable.sort((a, b) => a.converted - b.converted || a.candidate.skuId.localeCompare(b.candidate.skuId));
    const lowest = comparable[0];
    if (!lowest) return entry;
    if (!alert.armed) {
      return lowest.converted > alert.rearmAbove
        ? { ...entry, alert: { ...alert, armed: true } }
        : entry;
    }
    if (lowest.converted > alert.targetAmount) return entry;
    events.push({
      entryId: entry.id,
      skuId: lowest.candidate.skuId,
      name: lowest.candidate.name,
      price: lowest.converted,
      currency: alert.targetCurrency,
      symbol: lowest.candidate.symbol,
    });
    return {
      ...entry,
      alert: {
        ...alert,
        armed: false,
        lastTriggeredAt: nowIso,
        lastTriggeredPrice: lowest.converted,
      },
    };
  });
  return { entries: nextEntries, events, skippedStaleProducts, skippedFx };
}

export function restoreFailedDeliveries(
  original: WatchEntry[], evaluated: WatchEntry[], failedEntryIds: Set<string>,
) {
  const originalById = new Map(original.map((entry) => [entry.id, entry]));
  return evaluated.map((entry) => failedEntryIds.has(entry.id || '')
    ? originalById.get(entry.id) || entry
    : entry);
}
