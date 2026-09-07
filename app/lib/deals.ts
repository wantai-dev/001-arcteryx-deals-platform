import { productCategory, productName, REGION_LABEL, REGION_OPTIONS } from './catalog';
import { normalizeSearchText } from './search';
import { convertAmount, type CurrencyPreference, type RateSnapshot } from './currency';
import type { DealSignal, Product } from './types';

export type DealFilters = {
  brand: string;
  platform: string;
  category: string;
  gender: string;
  series: string;
  sort: string;
  minDiscount?: 0 | 30 | 50;
  lowOnly?: boolean;
};

export const DEFAULT_DEAL_FILTERS: DealFilters = {
  brand: 'all',
  platform: 'all',
  category: 'all',
  gender: 'all',
  series: 'all',
  sort: 'discount_desc',
  minDiscount: 0,
  lowOnly: false,
};

export const DEAL_PAGE_SIZE = 300;

export function nextDealVisibleLimit(current: number, total: number) {
  const retained = Math.max(DEAL_PAGE_SIZE, current);
  return total > retained
    ? Math.min(retained + DEAL_PAGE_SIZE, total)
    : retained;
}

export type DealFilterOptions = {
  signals?: Record<string, DealSignal>;
  targetCurrency?: CurrencyPreference;
  rateSnapshot?: RateSnapshot | null;
};

export function productsForRegion(products: Product[], region: string) {
  return region === 'all' ? products : products.filter((product) => product.region === region);
}

export function availableDealRegions(products: Product[]) {
  const present = new Set(products.map((product) => product.region).filter(Boolean));
  const preferred = REGION_OPTIONS.filter((region) => region !== 'all' && present.has(region));
  const extras = [...present]
    .filter((region) => !preferred.includes(region))
    .sort((a, b) => (REGION_LABEL[a] || a).localeCompare(REGION_LABEL[b] || b));
  return ['all', ...preferred, ...extras];
}

export function filterDeals(products: Product[], region: string, query: string, filters: DealFilters, options: DealFilterOptions = {}) {
  const q = normalizeSearchText(query);
  const rows = productsForRegion(products, region).filter((product) => {
    if (filters.brand !== 'all' && product._brand !== filters.brand) return false;
    if (filters.platform !== 'all' && product._platform !== filters.platform) return false;
    if (filters.gender !== 'all') {
      const gender = product.gender === 'unknown' ? 'unisex' : product.gender || 'unisex';
      if (gender !== filters.gender) return false;
    }
    if (filters.category !== 'all' && productCategory(product) !== filters.category) return false;
    if (filters.series !== 'all' && product._series !== filters.series) return false;
    if (product.discount_pct < (filters.minDiscount ?? 0)) return false;
    if (filters.lowOnly && options.signals?.[product.sku_id]?.kind !== 'all_time_low') return false;
    if (q) {
      const haystack = normalizeSearchText(`${product._brand} ${product.brand} ${productName(product)} ${product.full_name || ''} ${product.model || ''} ${product.description || ''} ${product.category || ''}`);
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  switch (filters.sort) {
    case 'price_asc':
      return rows.sort((a, b) => comparePrice(a, b, options, 1));
    case 'price_desc':
      return rows.sort((a, b) => comparePrice(a, b, options, -1));
    case 'recent':
      return rows.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
    case 'discount_desc':
    default:
      return rows.sort((a, b) => (b.discount_pct || 0) - (a.discount_pct || 0));
  }
}

function comparablePrice(product: Product, options: DealFilterOptions): number | null {
  const target = options.targetCurrency ?? 'original';
  if (target === 'original') return null;
  const converted = convertAmount(product.sale_price, product.currency, target, options.rateSnapshot ?? null);
  return converted.currency === target ? converted.value : null;
}

function comparePrice(left: Product, right: Product, options: DealFilterOptions, direction: 1 | -1): number {
  const leftPrice = comparablePrice(left, options);
  const rightPrice = comparablePrice(right, options);
  if (leftPrice !== null && rightPrice !== null) return direction * (leftPrice - rightPrice) || left.sku_id.localeCompare(right.sku_id);
  if (leftPrice !== null) return -1;
  if (rightPrice !== null) return 1;
  return left.currency.localeCompare(right.currency)
    || direction * (left.sale_price - right.sale_price)
    || left.sku_id.localeCompare(right.sku_id);
}
