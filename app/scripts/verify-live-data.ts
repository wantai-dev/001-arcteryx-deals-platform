import assert from 'node:assert/strict';

import { productCategory, SUPABASE_ANON, SUPABASE_URL, visibleProducts } from '../lib/catalog';
import { findCheaperAlternatives } from '../lib/cheaperAlternatives';
import { fetchRateSnapshot } from '../lib/currency';
import { availableDealRegions, DEFAULT_DEAL_FILTERS, filterDeals } from '../lib/deals';
import { localizedCategory } from '../lib/i18n';
import { loadCompleteHistory } from '../lib/historyData';
import { INITIAL_PRODUCT_LIMIT, INITIAL_PRODUCT_REGION } from '../lib/productPreview';
import { computeSignal, groupHistoryBySku } from '../lib/signals';
import type { CatalogProduct, CatalogProductRow, PriceHistoryRow, Product, ProductRow } from '../lib/types';
import { groupYearbookArchive, indexYearbookDeals, normalizeCatalogProduct } from '../lib/yearbook';

const headers = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
};

// Match the production quality gate's source-aware low-water marks. Aggregate
// catalog size is diagnostic only because official assortments contract; every
// required platform/region slice must remain independently healthy.
const PLATFORM_REGION_MIN_ROWS: Record<string, number> = {
  'arcteryx_outlet/us': 250,
  'arcteryx_outlet/ca': 100,
  'arcteryx_outlet/au': 10,
  'arcteryx_outlet/at': 250,
  'arcteryx_outlet/be': 250,
  'arcteryx_outlet/ch': 250,
  'arcteryx_outlet/de': 250,
  'arcteryx_outlet/dk': 250,
  'arcteryx_outlet/es': 250,
  'arcteryx_outlet/fr': 250,
  'arcteryx_outlet/gb': 250,
  'arcteryx_outlet/it': 250,
  'arcteryx_outlet/nl': 250,
  'arcteryx_outlet/se': 250,
  'evo/us': 100,
  'mec/ca': 75,
  'rei/us': 40,
};

const YEARBOOK_BRAND_MIN_ROWS: Record<string, number> = {
  arcteryx: 300,
  burton: 400,
  patagonia: 400,
};

const NON_CHINESE_LANGUAGES = ['en', 'de', 'fr', 'ja'] as const;
const YEARBOOK_LOCALIZATION_LANGUAGES = ['zh-Hans', ...NON_CHINESE_LANGUAGES] as const;

const YEARBOOK_COLUMNS = [
  'catalog_product_id', 'brand_key', 'official_product_id', 'brand', 'catalog_scope', 'market',
  'country', 'language', 'name', 'gender', 'collection', 'categories', 'category_sources',
  'list_price', 'list_price_max', 'currency', 'color_names', 'primary_colors', 'season_codes',
  'source_name', 'source_url', 'source_hash', 'status', 'first_seen_at', 'last_seen_at',
  'last_changed_at',
].join(',');

async function rest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 180)}`);
  return {
    data: text ? (JSON.parse(text) as T) : null,
    contentRange: response.headers.get('content-range') || '',
  };
}

async function loadProducts() {
  const pageSize = 1000;
  const rows: ProductRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data } = await rest<ProductRow[]>(`products?select=*&status=eq.active&offset=${offset}&limit=${pageSize}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize || offset > 50000) break;
  }

  return visibleProducts(rows);
}

async function loadYearbook() {
  const pageSize = 1000;
  const rows: CatalogProductRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await rest<CatalogProductRow[]>(
      `catalog_products?select=${YEARBOOK_COLUMNS}&status=eq.active&order=brand_key.asc,official_product_id.asc&offset=${offset}&limit=${pageSize}`,
    );
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize || offset > 10000) break;
  }
  const results = rows.map((row) => ({ row, product: normalizeCatalogProduct(row) }));
  const normalized = results.map(({ product }) => product).filter((product): product is CatalogProduct => product !== null);
  const rejected = results
    .filter(({ product }) => product === null)
    .map(({ row }) => ({
      catalog_product_id: row.catalog_product_id,
      brand_key: row.brand_key,
      official_product_id: row.official_product_id,
      list_price: row.list_price,
      list_price_max: row.list_price_max,
    }));
  const maxRejected = Math.max(1, Math.floor(rows.length * 0.001));
  assert.ok(
    rejected.every((row) => Number(row.list_price) <= 0 && Number(row.list_price_max) <= 0),
    'Yearbook may tolerate only a capped set of non-positive-price rows; every other contract rejection is blocking',
  );
  assert.ok(
    rejected.length <= maxRejected,
    `active Yearbook contract rejections exceeded the 0.1% safety cap (${rejected.length}/${rows.length})`,
  );
  return { products: normalized, rejected };
}

async function loadHistory(skuIds: string[]) {
  return loadCompleteHistory(skuIds, async ({ skuIds: batch, from, to, throughIso }) => {
    const ids = batch.map((skuId) => JSON.stringify(skuId)).join(',');
    const params = new URLSearchParams({
      select: 'sku_id,sale_price,original_price,recorded_at,currency',
      sku_id: `in.(${ids})`, order: 'id.asc', recorded_at: `lte.${throughIso}`,
      offset: String(from), limit: String(to - from + 1),
    });
    const { data } = await rest<PriceHistoryRow[]>(`price_history?${params}`);
    return data || [];
  });
}

async function main() {
  const { contentRange: productsRange } = await rest<ProductRow[]>('products?select=sku_id&status=eq.active&limit=1', {
    headers: { Range: '0-0', Prefer: 'count=exact' },
  });
  const { contentRange: historyRange } = await rest<PriceHistoryRow[]>('price_history?select=sku_id&limit=1', {
    headers: { Range: '0-0', Prefer: 'count=exact' },
  });
  const { contentRange: yearbookRange } = await rest<CatalogProductRow[]>('catalog_products?select=catalog_product_id&status=eq.active&limit=1', {
    headers: { Range: '0-0', Prefer: 'count=exact' },
  });

  const products = await loadProducts();
  const rateSnapshot = await fetchRateSnapshot();
  const { products: yearbook, rejected: yearbookRejectedRows } = await loadYearbook();
  const productImageUrls = products
    .flatMap((product) => [product.image_url, ...product.images])
    .filter((value): value is string => Boolean(value));
  const invalidProductImageUrls = productImageUrls.filter((value) => !value.startsWith('https://'));
  assert.deepEqual(
    invalidProductImageUrls,
    [],
    `normalized product images must use absolute HTTPS URLs; invalid count: ${invalidProductImageUrls.length}`,
  );
  const dealCategories = [...new Set(products.map(productCategory))].sort((left, right) => left.localeCompare(right));
  const dealCategoryLocalizationGaps = NON_CHINESE_LANGUAGES.flatMap((language) => dealCategories
    .filter((category) => /\p{Script=Han}/u.test(category) && localizedCategory(language, category) === category)
    .map((category) => `${language}:${category}`));
  assert.deepEqual(
    dealCategoryLocalizationGaps,
    [],
    `active deal categories must not leak untranslated Chinese labels: ${dealCategoryLocalizationGaps.join(', ')}`,
  );
  const yearbookCategories = [...new Set(yearbook.flatMap((product) => product.categories))].sort((left, right) => left.localeCompare(right));
  const yearbookCategoryLocalizationGaps = YEARBOOK_LOCALIZATION_LANGUAGES.flatMap((language) => yearbookCategories
    .filter((category) => localizedCategory(language, category) === category)
    .map((category) => `${language}:${category}`));
  assert.deepEqual(
    yearbookCategoryLocalizationGaps,
    [],
    `active Yearbook categories must have all five localized labels: ${yearbookCategoryLocalizationGaps.join(', ')}`,
  );
  const { data: previewRows } = await rest<ProductRow[]>(
    `products?select=*&status=eq.active&region=eq.${INITIAL_PRODUCT_REGION}&order=discount_pct.desc,sku_id.asc&limit=${INITIAL_PRODUCT_LIMIT}`,
  );
  const preview = visibleProducts(previewRows || []);
  assert.ok(preview.length >= 190, `expected at least 190 startup preview products, got ${preview.length}`);
  assert.ok(preview.every((product) => product.region === INITIAL_PRODUCT_REGION), 'startup preview must stay in the default region');
  assert.ok(preview.every((product) => product.image_url || product.images.length), 'startup preview must have product images');
  const availableRegions = availableDealRegions(products);
  const regionCounts = Object.fromEntries(availableRegions.slice(1).map((region) => [region, filterDeals(products, region, '', DEFAULT_DEAL_FILTERS).length]));
  const platformRegionCounts = products.reduce<Record<string, number>>((counts, product) => {
    const key = `${product.dealer || 'arcteryx_outlet'}/${product.region}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  for (const [key, minimum] of Object.entries(PLATFORM_REGION_MIN_ROWS)) {
    assert.ok((platformRegionCounts[key] ?? 0) >= minimum, `${key} expected at least ${minimum} products, got ${platformRegionCounts[key] ?? 0}`);
  }
  const yearbookBrandCounts = yearbook.reduce<Record<string, number>>((counts, product) => {
    counts[product.brand_key] = (counts[product.brand_key] || 0) + 1;
    return counts;
  }, {});
  for (const [brand, minimum] of Object.entries(YEARBOOK_BRAND_MIN_ROWS)) {
    assert.ok((yearbookBrandCounts[brand] ?? 0) >= minimum, `${brand} Yearbook expected at least ${minimum} products, got ${yearbookBrandCounts[brand] ?? 0}`);
  }
  const yearbookIndex = indexYearbookDeals(yearbook, products);
  const linkedYearbookByBrand = Object.keys(yearbookIndex.byCatalogId).reduce<Record<string, number>>((counts, catalogId) => {
    const brand = catalogId.split(':')[0] || 'unknown';
    counts[brand] = (counts[brand] || 0) + 1;
    return counts;
  }, {});
  for (const brand of Object.keys(YEARBOOK_BRAND_MIN_ROWS)) {
    assert.ok((linkedYearbookByBrand[brand] ?? 0) > 0, `${brand} Yearbook must have at least one deterministically linked live deal`);
  }
  const yearbookArchive = groupYearbookArchive(yearbookIndex.unmatched);
  assert.ok(yearbookArchive.length > 0, 'Yearbook archive should retain unmatched discounted styles');
  assert.ok((regionCounts.de ?? 0) > 0, 'DE region filter should return current deals');
  assert.ok((regionCounts.ca ?? 0) > 0, 'CA region filter should return current deals');
  assert.equal(availableRegions.includes('jp'), false, 'regions without loaded deals must not appear in the selector');

  const deEuro = products.find((product) => product.region === 'de' && product.symbol === '€' && /beta/i.test(`${product.full_name || ''} ${product.model || ''}`));
  assert.ok(deEuro, 'missing DE euro beta sample');

  const betaResults = products.filter((product) => `${product.full_name || ''} ${product.model || ''} ${product.description || ''}`.toLowerCase().includes('beta'));
  assert.ok(betaResults.length > 0, 'beta search should return products');

  const signalProduct = products.find((product) => product.sku_id === 'kopec-mid-gtx-boot-0029_Black_Nightscape_be') || products.find((product) => product.sku_id && product.sale_price > 0);
  assert.ok(signalProduct, 'missing product for signal probe');
  const historyRows = await loadHistory([signalProduct.sku_id]);
  const signal = computeSignal(signalProduct, historyRows);
  assert.ok(['all_time_low', 'ninety_day_low', 'drop_today', 'steady', 'insufficient'].includes(signal.kind));

  const cheaperBase = products.find((product) => product.sku_id === 'kopec-mid-gtx-boot-0029_Black_Nightscape_be') || deEuro;
  assert.ok(cheaperBase, 'missing product for cheaper alternative probe');
  const cheaper = findCheaperAlternatives(products, cheaperBase, rateSnapshot);

  console.log(
    JSON.stringify(
      {
        products_content_range: productsRange,
        price_history_content_range: historyRange,
        yearbook_content_range: yearbookRange,
        paginated_products_loaded: products.length,
        product_image_urls: productImageUrls.length,
        invalid_product_image_urls: invalidProductImageUrls.length,
        yearbook_products_loaded: yearbook.length,
        yearbook_rejected_rows: yearbookRejectedRows,
        deal_category_count: dealCategories.length,
        deal_category_localization_gaps: dealCategoryLocalizationGaps,
        yearbook_category_count: yearbookCategories.length,
        yearbook_category_localization_gaps: yearbookCategoryLocalizationGaps,
        yearbook_brand_counts: yearbookBrandCounts,
        yearbook_linked_styles_by_brand: linkedYearbookByBrand,
        yearbook_match_counts: yearbookIndex.matchCounts,
        yearbook_archive_styles: yearbookArchive.length,
        startup_preview_loaded: preview.length,
        startup_preview_region: INITIAL_PRODUCT_REGION,
        region_counts: regionCounts,
        platform_region_counts: platformRegionCounts,
        de_euro_beta_sample: {
          sku_id: deEuro.sku_id,
          sale_price: deEuro.sale_price,
          symbol: deEuro.symbol,
          region: deEuro.region,
        },
        beta_result_count: betaResults.length,
        signal_sample: {
          sku_id: signalProduct.sku_id,
          kind: signal.kind,
          label: signal.label,
          history_rows: historyRows.length,
        },
        cheaper_region_sample: {
          base: {
            sku_id: cheaperBase.sku_id,
            region: cheaperBase.region,
            price: cheaperBase.sale_price,
            symbol: cheaperBase.symbol,
          },
          cheaper: cheaper.slice(0, 3).map((product) => ({
            sku_id: product.sku_id,
            region: product.region,
            price: product.sale_price,
            symbol: product.symbol,
          })),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
