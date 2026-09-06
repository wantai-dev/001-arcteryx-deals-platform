import AsyncStorage from '@react-native-async-storage/async-storage';

import { RATES_STORAGE_KEY } from '../contexts/PreferencesContext';
import { productName, visibleProducts } from './catalog';
import { modelKeyForProduct } from './modelWatch';
import type { PriceCandidate } from './priceMonitor';
import { supabase } from './supabase';
import type { ProductRow, WatchEntry } from './types';
import type { RateSnapshot as CurrencyRateSnapshot } from './currency';

async function fetchRows(column: 'sku_id' | 'official_product_id', values: string[]) {
  const rows: ProductRow[] = [];
  for (let offset = 0; offset < values.length; offset += 45) {
    const { data, error } = await supabase.from('products').select('*')
      .eq('status', 'active').in(column, values.slice(offset, offset + 45));
    if (error) throw error;
    rows.push(...((data || []) as ProductRow[]));
  }
  return rows;
}

export async function fetchPriceCandidates(entries: WatchEntry[]): Promise<PriceCandidate[]> {
  const skuIds = entries.filter((entry) => entry.scope !== 'model' && entry.skuId).map((entry) => entry.skuId);
  const officialIds = entries.map((entry) => entry.snapshot?.officialProductId).filter((value): value is string => Boolean(value));
  const hasFallbackModel = entries.some((entry) => entry.scope === 'model' && !entry.snapshot?.officialProductId);
  const [skuRows, officialRows, fallbackRows] = await Promise.all([
    fetchRows('sku_id', [...new Set(skuIds)]),
    fetchRows('official_product_id', [...new Set(officialIds)]),
    hasFallbackModel
      ? supabase.from('products').select('*').eq('status', 'active').limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (fallbackRows.error) throw fallbackRows.error;
  const deduped = new Map<string, ProductRow>();
  for (const row of [...skuRows, ...officialRows, ...((fallbackRows.data || []) as ProductRow[])]) {
    if (row.sku_id) deduped.set(row.sku_id, row);
  }
  const products = visibleProducts([...deduped.values()]);
  return products.map((product) => ({
    skuId: product.sku_id,
    modelKey: modelKeyForProduct(product),
    name: productName(product),
    price: product.sale_price,
    currency: product.currency,
    symbol: product.symbol,
    updatedAt: product.last_updated || product.last_seen_at || '',
  }));
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
