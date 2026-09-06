import AsyncStorage from '@react-native-async-storage/async-storage';

import { RATES_STORAGE_KEY } from '../contexts/PreferencesContext';
import { visibleProducts } from './catalog';
import { productsToPriceCandidates } from './priceCandidateMapper';
import { resolveCurrentModelSkus } from './modelCandidateResolver';
import type { PriceCandidate } from './priceMonitor';
import { fetchYearbookProducts, supabase } from './supabase';
import type { ProductRow, WatchEntry } from './types';
import type { RateSnapshot as CurrencyRateSnapshot } from './currency';

async function fetchRows(column: 'sku_id' | 'official_product_id', values: string[]) {
  if (!values.length) return [] as ProductRow[];
  const rows: ProductRow[] = [];
  for (let batchStart = 0; batchStart < values.length; batchStart += 45) {
    const batch = values.slice(batchStart, batchStart + 45);
    for (let pageStart = 0; ; pageStart += 1000) {
      const { data, error } = await supabase.from('products').select('*')
        .eq('status', 'active').in(column, batch).range(pageStart, pageStart + 999);
      if (error) throw error;
      const page = (data || []) as ProductRow[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
  }
  return rows;
}

const PRODUCT_COLUMNS = [
  'sku_id', 'brand', 'model', 'full_name', 'color', 'sizes', 'size_stock', 'original_price',
  'sale_price', 'discount_pct', 'currency', 'symbol', 'gender', 'region', 'region_name',
  'category', 'url', 'image_url', 'images', 'description', 'status', 'last_seen_at',
  'last_updated', 'dealer', 'first_seen', 'official_product_id',
].join(',');

async function fetchActiveRowsForBrands(brands: string[]) {
  if (!brands.length) return [] as ProductRow[];
  const rows: ProductRow[] = [];
  for (let offset = 0; offset <= 50000; offset += 1000) {
    const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS)
      .eq('status', 'active').in('brand', brands).order('sku_id', { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    const page = (data || []) as unknown as ProductRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error('Watched-brand product query exceeded the safety bound.');
}

export async function fetchPriceCandidates(entries: WatchEntry[]): Promise<PriceCandidate[]> {
  const skuIds = entries.filter((entry) => entry.scope !== 'model' && entry.skuId).map((entry) => entry.skuId);
  const watchedBrands = [...new Set(entries.filter((entry) => entry.scope === 'model')
    .map((entry) => entry.snapshot?.brand)
    .filter((brand): brand is 'arcteryx' | 'burton' | 'patagonia' => (
      brand === 'arcteryx' || brand === 'burton' || brand === 'patagonia'
    )))];
  const [skuRows, modelRows, catalog] = await Promise.all([
    fetchRows('sku_id', [...new Set(skuIds)]),
    fetchActiveRowsForBrands(watchedBrands),
    watchedBrands.length ? fetchYearbookProducts() : Promise.resolve([]),
  ]);
  const deduped = new Map<string, ProductRow>();
  for (const row of [...skuRows, ...modelRows]) {
    if (row.sku_id) deduped.set(row.sku_id, row);
  }
  const products = visibleProducts([...deduped.values()]);
  const resolvedModelBySku = resolveCurrentModelSkus(
    entries, catalog.filter((item) => watchedBrands.includes(item.brand_key)), products,
  );
  return productsToPriceCandidates(products, resolvedModelBySku);
}

export async function readCachedRateSnapshot(): Promise<CurrencyRateSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(RATES_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CurrencyRateSnapshot;
    return value?.date && value?.fetchedAt && value?.rates?.EUR === 1 ? value : null;
  } catch {
    return null;
  }
}
