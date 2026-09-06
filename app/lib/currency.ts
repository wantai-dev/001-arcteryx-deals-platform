export const CURRENCY_OPTIONS = ['original', 'CNY', 'USD', 'CAD', 'EUR', 'GBP', 'JPY', 'CHF'] as const;
export const RATE_QUOTES = ['USD', 'CAD', 'GBP', 'JPY', 'CHF', 'CNY', 'SEK', 'DKK', 'AUD'] as const;

export type CurrencyPreference = (typeof CURRENCY_OPTIONS)[number];
export type CurrencyCode = Exclude<CurrencyPreference, 'original'> | 'SEK' | 'DKK' | 'AUD';

export type RateSnapshot = {
  date: string;
  fetchedAt: string;
  rates: Record<string, number>;
};

export const RATES_URL = `https://api.frankfurter.dev/v2/rates?base=EUR&quotes=${RATE_QUOTES.join(',')}`;

type RateRow = { date?: string; base?: string; quote?: string; rate?: number };

export function parseRateRows(value: unknown, fetchedAt = new Date().toISOString()): RateSnapshot | null {
  if (!Array.isArray(value)) return null;
  const rates: Record<string, number> = { EUR: 1 };
  let date = '';
  for (const item of value as RateRow[]) {
    if (!item || item.base !== 'EUR' || !item.quote || !Number.isFinite(item.rate) || Number(item.rate) <= 0) continue;
    rates[item.quote] = Number(item.rate);
    if (item.date && item.date > date) date = item.date;
  }
  return Object.keys(rates).length > 1 && date ? { date, fetchedAt, rates } : null;
}

export function convertAmount(value: number, source: string, target: CurrencyPreference, snapshot: RateSnapshot | null) {
  if (target === 'original' || source === target) return { value, currency: source, converted: false };
  const sourceRate = snapshot?.rates[source];
  const targetRate = snapshot?.rates[target];
  if (!sourceRate || !targetRate) return { value, currency: source, converted: false };
  return { value: (value / sourceRate) * targetRate, currency: target, converted: true };
}

export function formatCurrencyValue(value: number, currency: string, locale: string, fallbackSymbol = '') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2,
    }).format(value);
  } catch {
    return `${fallbackSymbol}${Math.round(value).toLocaleString(locale)}`;
  }
}

export async function fetchRateSnapshot(fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(RATES_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`rate request failed with HTTP ${response.status}`);
    const snapshot = parseRateRows(await response.json());
    if (!snapshot) throw new Error('rate response was empty or invalid');
    return snapshot;
  } finally {
    clearTimeout(timeout);
  }
}
