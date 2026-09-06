import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import { SUPABASE_ANON, SUPABASE_URL, visibleProducts } from './catalog';
import { postPriceAlert } from './priceAlerts';
import { INITIAL_PRODUCT_LIMIT, INITIAL_PRODUCT_REGION } from './productPreview';
import { loadCompleteHistory } from './historyData';
import type { CatalogProduct, CatalogProductRow, PriceAlertRequest, PriceHistoryRow, ProductRow } from './types';
import { normalizeCatalogProduct } from './yearbook';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

export async function fetchInitialProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'active')
    .eq('region', INITIAL_PRODUCT_REGION)
    .order('discount_pct', { ascending: false })
    .order('sku_id', { ascending: true })
    .limit(INITIAL_PRODUCT_LIMIT);
  if (error) throw error;
  return visibleProducts((data || []) as ProductRow[]);
}

export async function fetchAllProducts() {
  const pageSize = 1000;
  const all: ProductRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('status', 'active')
      .order('sku_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as ProductRow[]));
    if (data.length < pageSize || offset > 50000) break;
  }

  return visibleProducts(all);
}

export async function fetchProductFamilyBySku(skuId: string) {
  const { data: target, error: targetError } = await supabase.from('products').select('url').eq('sku_id', skuId).eq('status', 'active').maybeSingle();
  if (targetError) throw targetError;
  if (!target?.url) {
    const { data, error } = await supabase.from('products').select('*').eq('sku_id', skuId).eq('status', 'active');
    if (error) throw error;
    return visibleProducts((data || []) as ProductRow[]);
  }
  const { data, error } = await supabase.from('products').select('*').eq('url', target.url).eq('status', 'active');
  if (error) throw error;
  return visibleProducts((data || []) as ProductRow[]);
}

export async function fetchPriceHistoryForSkus(skuIds: string[], sinceIso?: string) {
  return loadCompleteHistory(skuIds, async ({ skuIds: batch, from, to, throughIso }) => {
    let query = supabase
      .from('price_history')
      .select('sku_id,sale_price,original_price,recorded_at,currency')
      .in('sku_id', batch)
      .lte('recorded_at', throughIso)
      .order('id', { ascending: true })
      .range(from, to);
    if (sinceIso) query = query.gte('recorded_at', sinceIso);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as PriceHistoryRow[];
  }, sinceIso);
}

export async function fetchPriceHistory(skuId: string, sinceIso?: string) {
  return fetchPriceHistoryForSkus([skuId], sinceIso);
}

export async function insertPriceAlert(request: PriceAlertRequest) {
  await postPriceAlert(SUPABASE_URL, SUPABASE_ANON, request);
}

const YEARBOOK_COLUMNS = [
  'catalog_product_id',
  'brand_key',
  'official_product_id',
  'brand',
  'catalog_scope',
  'market',
  'country',
  'language',
  'name',
  'gender',
  'collection',
  'categories',
  'category_sources',
  'list_price',
  'list_price_max',
  'currency',
  'color_names',
  'primary_colors',
  'season_codes',
  'source_name',
  'source_url',
  'source_hash',
  'status',
  'first_seen_at',
  'last_seen_at',
  'last_changed_at',
].join(',');

export async function fetchYearbookProducts() {
  const pageSize = 1000;
  const rows: CatalogProductRow[] = [];
  for (let offset = 0; offset <= 10000; offset += pageSize) {
    const { data, error } = await supabase
      .from('catalog_products')
      .select(YEARBOOK_COLUMNS)
      .eq('status', 'active')
      .order('brand_key', { ascending: true })
      .order('official_product_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as unknown as CatalogProductRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows
    .map(normalizeCatalogProduct)
    .filter((product): product is CatalogProduct => product !== null);
}
