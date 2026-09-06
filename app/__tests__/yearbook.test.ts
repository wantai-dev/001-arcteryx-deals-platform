import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bestYearbookOffers,
  comparableYearbookOffer,
  filterYearbookArchive,
  filterYearbookProducts,
  formatCatalogPrice,
  groupYearbookArchive,
  indexYearbookDeals,
  normalizeCatalogProduct,
  yearbookBrands,
  yearbookCategories,
  yearbookFreshnessLabel,
  yearbookYear,
  yearbookYears,
} from '../lib/yearbook';
import type { CatalogProductRow, Product } from '../lib/types';

function arcRow(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    catalog_product_id: 'arcteryx:x000009715',
    brand_key: 'arcteryx',
    official_product_id: 'X000009715',
    brand: "Arc'teryx",
    catalog_scope: 'full_price',
    market: 'outdoor',
    country: 'us',
    language: 'en',
    name: "Vertex Speed Low Shoe Men's",
    gender: 'men',
    collection: null,
    categories: ['footwear'],
    category_sources: { footwear: 'official_category_feed' },
    list_price: 180,
    list_price_max: 180,
    currency: 'USD',
    color_names: ['Black/Arctic Silk'],
    primary_colors: ['Black'],
    season_codes: ['S25', 'F26'],
    source_name: 'arcteryx_us_official_product_feed',
    source_url: 'https://arcteryx.com/us/en/shop/mens/vertex-speed-low-shoe-9715',
    source_hash: 'a'.repeat(64),
    status: 'active',
    first_seen_at: '2026-08-04T10:00:00Z',
    last_seen_at: '2026-08-04T10:00:00Z',
    last_changed_at: '2026-08-04T10:00:00Z',
    ...overrides,
  };
}

function burtonRow(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    ...arcRow(),
    catalog_product_id: 'burton:106881',
    brand_key: 'burton',
    official_product_id: '106881',
    brand: 'Burton',
    market: 'snow',
    name: "Men's Burton Custom Camber Snowboard",
    categories: ['boards'],
    category_sources: { boards: 'official_shopify_product_type' },
    list_price: 699.95,
    list_price_max: 699.95,
    color_names: ['Graphic'],
    primary_colors: [],
    season_codes: [],
    source_name: 'burton_us_official_collection_json',
    source_url: 'https://www.burton.com/en-us/products/mens-burton-custom-camber-snowboard-106881',
    first_seen_at: '2025-05-01T00:00:00Z',
    ...overrides,
  };
}

function patagoniaRow(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    ...arcRow(),
    catalog_product_id: 'patagonia:37996',
    brand_key: 'patagonia',
    official_product_id: '37996',
    brand: 'Patagonia',
    country: 'au',
    name: 'Airfarer Cap',
    gender: 'unisex',
    categories: ['headwear', 'caps'],
    category_sources: { headwear: 'official_shopify_tag:type', caps: 'official_shopify_tag:subtype' },
    list_price: 49.95,
    list_price_max: 54.95,
    currency: 'AUD',
    color_names: ['P-6 Logo: Weathered Stone', 'Strata Stencil: Black'],
    primary_colors: ['Green', 'Black'],
    season_codes: ['W26'],
    source_name: 'patagonia_au_official_collection_json',
    source_url: 'https://www.patagonia.com.au/products/airfarer-cap-37996-plws',
    ...overrides,
  };
}

function deal(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    sku_id: 'burton:deal-1',
    brand: 'burton',
    model: "Men's Burton Custom Camber Snowboard",
    full_name: "Men's Burton Custom Camber Snowboard",
    color: 'Graphic',
    sizes: ['156'],
    size_stock: { '156': 'in_stock' },
    original_price: 699.95,
    sale_price: 489.95,
    discount_pct: 30,
    currency: 'USD',
    symbol: '$',
    gender: 'men',
    region: 'us',
    region_name: 'United States',
    category: '滑雪板',
    url: 'https://www.burton.com/en-us/products/mens-burton-custom-camber-snowboard-106881',
    image_url: null,
    images: [],
    description: null,
    last_updated: '2026-08-12T08:00:00Z',
    created_at: '2026-08-12T08:00:00Z',
    dealer: 'burton',
    first_seen: '2026-08-12T08:00:00Z',
    official_product_id: '106881',
    _brand: 'burton',
    _series: 'Custom',
    _platform: 'burton',
    ...overrides,
  };
}

test('normalizes all three official source contracts and Supabase arrays', () => {
  const arc = normalizeCatalogProduct(arcRow({ categories: '["footwear","trail"]', list_price: '180' }));
  const burton = normalizeCatalogProduct(burtonRow());
  const patagonia = normalizeCatalogProduct(patagoniaRow());

  assert.ok(arc && burton && patagonia);
  assert.deepEqual(arc.categories, ['footwear', 'trail']);
  assert.equal(burton.brand_key, 'burton');
  assert.equal(patagonia.currency, 'AUD');
});

test('rejects null, blank, zero, and negative official prices', () => {
  assert.equal(normalizeCatalogProduct(arcRow({ list_price: null })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ list_price: '' })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ list_price: '   ' })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ list_price: 0 })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ list_price: -1 })), null);
});

test('rejects cross-brand identities, third-party links, inactive rows, and invalid prices', () => {
  assert.equal(normalizeCatalogProduct(burtonRow({ source_url: 'https://www.backcountry.com/burton' })), null);
  assert.equal(normalizeCatalogProduct(burtonRow({ catalog_product_id: 'patagonia:106881' })), null);
  assert.equal(normalizeCatalogProduct(patagoniaRow({ country: 'us' })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ status: 'inactive' })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ list_price_max: 100 })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ source_hash: 'not-a-hash' })), null);
  assert.equal(normalizeCatalogProduct(arcRow({ first_seen_at: 'not-a-date' })), null);
});

test('uses official season codes as year and first-seen as fallback', () => {
  const arc = normalizeCatalogProduct(arcRow());
  const patagonia = normalizeCatalogProduct(patagoniaRow());
  const burton = normalizeCatalogProduct(burtonRow({ first_seen_at: '2025-05-01T00:00:00Z' }));
  assert.ok(arc && patagonia && burton);
  assert.equal(yearbookYear(arc), 2026);
  assert.equal(yearbookYear(patagonia), 2026);
  assert.equal(yearbookYear(burton), 2025);
});

test('filters independently by brand, text, gender, category, and year', () => {
  const arc = normalizeCatalogProduct(arcRow());
  const burton = normalizeCatalogProduct(burtonRow());
  const patagonia = normalizeCatalogProduct(patagoniaRow());
  assert.ok(arc && burton && patagonia);
  const products = [arc, burton, patagonia];

  assert.deepEqual(filterYearbookProducts(products, { query: 'strata' }).map((item) => item.catalog_product_id), ['patagonia:37996']);
  assert.deepEqual(filterYearbookProducts(products, { query: "Arc'teryx" }).map((item) => item.catalog_product_id), ['arcteryx:x000009715']);
  assert.deepEqual(filterYearbookProducts(products, { query: 'Arc teryx' }).map((item) => item.catalog_product_id), ['arcteryx:x000009715']);
  assert.deepEqual(filterYearbookProducts(products, { brand: 'burton' }).map((item) => item.catalog_product_id), ['burton:106881']);
  assert.deepEqual(filterYearbookProducts(products, { gender: 'unisex' }).map((item) => item.catalog_product_id), ['patagonia:37996']);
  assert.deepEqual(filterYearbookProducts(products, { category: 'footwear' }).map((item) => item.catalog_product_id), ['arcteryx:x000009715']);
  assert.deepEqual(filterYearbookProducts(products, { year: 2025 }).map((item) => item.catalog_product_id), ['burton:106881']);
  assert.deepEqual(yearbookBrands(products), ['arcteryx', 'burton', 'patagonia']);
  assert.deepEqual(yearbookYears(products), [2026, 2025]);
  assert.deepEqual(yearbookCategories(products), ['boards', 'caps', 'footwear', 'headwear']);
});

test('normalizes punctuation and spacing when searching unlinked deal styles', () => {
  const archive = groupYearbookArchive([
    deal({
      sku_id: 'arcteryx-beta-archive',
      brand: 'arcteryx',
      model: "Arc'teryx Beta Jacket",
      full_name: "Arc'teryx Beta Jacket",
      url: 'https://www.evo.com/products/arcteryx-beta-jacket',
      official_product_id: null,
      _brand: 'arcteryx',
      _platform: 'evo',
    }),
  ]);

  assert.equal(filterYearbookArchive(archive, { query: "Arc'teryx" }).length, 1);
  assert.equal(filterYearbookArchive(archive, { query: 'Arc teryx' }).length, 1);
});

test('formats single and ranged prices in each source currency', () => {
  const burton = normalizeCatalogProduct(burtonRow());
  const patagonia = normalizeCatalogProduct(patagoniaRow());
  assert.ok(burton && patagonia);
  assert.match(formatCatalogPrice(burton), /699\.95/);
  assert.match(formatCatalogPrice(patagonia), /49\.95.*54\.95/);
  assert.match(formatCatalogPrice(patagonia, 'de-DE'), /49,95.*54,95/);
  assert.equal(yearbookFreshnessLabel('2026-08-26T08:00:00Z', 'en-US', Date.parse('2026-08-27T08:00:00Z')), 'yesterday');
});

test('freshness labels fall back safely when Hermes omits Intl.RelativeTimeFormat', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat');
  Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, value: undefined });
  try {
    const now = Date.parse('2026-08-27T08:00:00Z');
    assert.equal(yearbookFreshnessLabel('2026-08-27T08:00:00Z', 'en-US', now), 'today');
    assert.equal(yearbookFreshnessLabel('2026-08-25T08:00:00Z', 'de-DE', now), 'vor 2 Tagen');
    assert.equal(yearbookFreshnessLabel('2026-08-24T08:00:00Z', 'zh-CN', now), '3 天前');
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'RelativeTimeFormat', descriptor);
  }
});

test('links discounted offers by official style id before conservative exact-name fallback', () => {
  const burton = normalizeCatalogProduct(burtonRow());
  const patagonia = normalizeCatalogProduct(patagoniaRow());
  assert.ok(burton && patagonia);
  const byId = deal();
  const byName = deal({
    id: 2,
    sku_id: 'evo:airfarer-cap',
    brand: 'patagonia',
    model: 'Patagonia Airfarer Cap',
    full_name: 'Patagonia Airfarer Cap',
    gender: 'unisex',
    original_price: 49,
    sale_price: 34,
    discount_pct: 31,
    currency: 'USD',
    dealer: 'evo',
    url: 'https://www.evo.com/products/patagonia-airfarer-cap',
    official_product_id: null,
    _brand: 'patagonia',
    _series: 'Airfarer',
    _platform: 'evo',
  });
  const fullPrice = deal({ id: 3, sku_id: 'burton:full', sale_price: 699.95, discount_pct: 0 });
  const officialPatagoniaUrl = deal({
    id: 4,
    sku_id: 'patagonia:official-url',
    brand: 'patagonia',
    model: 'Archived listing name',
    full_name: 'Archived listing name',
    gender: 'unisex',
    original_price: 49.95,
    sale_price: 29.95,
    discount_pct: 40,
    currency: 'AUD',
    symbol: 'A$',
    region: 'au',
    dealer: 'patagonia',
    url: 'https://www.patagonia.com.au/products/airfarer-cap-37996-plws',
    official_product_id: null,
    _brand: 'patagonia',
    _series: 'Airfarer',
    _platform: 'patagonia',
  });

  const indexed = indexYearbookDeals([burton, patagonia], [byId, byName, fullPrice, officialPatagoniaUrl]);

  assert.deepEqual(indexed.byCatalogId['burton:106881']!.map((item) => item.sku_id), ['burton:deal-1']);
  assert.deepEqual(indexed.byCatalogId['patagonia:37996']!.map((item) => item.sku_id), [
    'patagonia:official-url',
    'evo:airfarer-cap',
  ]);
  assert.deepEqual(indexed.matchCounts, { official_id: 2, exact_name: 1, unmatched: 0 });
});

test('never guesses an ambiguous name or crosses brand identities', () => {
  const first = normalizeCatalogProduct(burtonRow());
  const second = normalizeCatalogProduct(burtonRow({
    catalog_product_id: 'burton:999999',
    official_product_id: '999999',
    source_url: 'https://www.burton.com/en-us/products/another-custom-board-999999',
  }));
  assert.ok(first && second);
  const ambiguous = deal({ official_product_id: null, url: 'https://www.backcountry.com/burton-custom-camber-snowboard' });
  const wrongBrand = deal({
    id: 4,
    sku_id: 'evo:wrong-brand',
    brand: 'patagonia',
    official_product_id: '106881',
    model: 'Different Item',
    full_name: 'Different Item',
    dealer: 'evo',
    url: 'https://www.evo.com/products/different-item',
    _brand: 'patagonia',
    _series: 'Different',
    _platform: 'evo',
  });

  const indexed = indexYearbookDeals([first, second], [ambiguous, wrongBrand]);

  assert.equal(Object.keys(indexed.byCatalogId).length, 0);
  assert.deepEqual(indexed.unmatched.map((item) => item.sku_id), ['burton:deal-1', 'evo:wrong-brand']);
  assert.deepEqual(indexed.matchCounts, { official_id: 0, exact_name: 0, unmatched: 2 });
});

test('keeps one lowest offer per currency and groups unmatched colors into archive styles', () => {
  const usdHigh = deal({
    id: 5,
    sku_id: 'burton:old-blue',
    official_product_id: '200000',
    model: 'Burton Archive Board',
    full_name: 'Burton Archive Board',
    color: 'Blue',
    sale_price: 299,
    original_price: 499,
    url: 'https://www.burton.com/en-us/products/burton-archive-board-200000-blue',
  });
  const usdLow = deal({
    id: 6,
    sku_id: 'backcountry:old-black',
    official_product_id: '200000',
    model: 'Burton Archive Board',
    full_name: 'Burton Archive Board',
    color: 'Black',
    sale_price: 249,
    original_price: 499,
    dealer: 'backcountry',
    url: 'https://www.backcountry.com/burton-archive-board',
    _platform: 'backcountry',
  });
  const cad = deal({
    id: 7,
    sku_id: 'dealer:old-cad',
    official_product_id: '200000',
    model: 'Burton Archive Board',
    full_name: 'Burton Archive Board',
    color: 'Blue',
    sale_price: 329,
    original_price: 599,
    currency: 'CAD',
    symbol: 'C$',
    region: 'ca',
    dealer: 'mec',
    url: 'https://www.mec.ca/en/product/archive-board',
    _platform: 'mec',
  });

  assert.deepEqual(bestYearbookOffers([usdHigh, cad, usdLow], 'USD').map((item) => item.sku_id), [
    'backcountry:old-black',
    'dealer:old-cad',
  ]);
  const rates = { date: '2026-09-07', fetchedAt: '2026-09-07T00:00:00Z', rates: { EUR: 1, USD: 0.5, CAD: 1 } };
  assert.equal(comparableYearbookOffer([usdLow, cad], 'EUR', rates).offer?.sku_id, 'dealer:old-cad');
  assert.equal(comparableYearbookOffer([usdLow, cad], 'EUR', rates).comparableAcrossCurrencies, true);
  assert.equal(comparableYearbookOffer([usdLow, cad], 'EUR', null).comparableAcrossCurrencies, false);
  const archive = groupYearbookArchive([usdHigh, cad, usdLow]);
  assert.equal(archive.length, 1);
  assert.equal(archive[0]!.official_product_id, '200000');
  assert.equal(archive[0]!.offers.length, 3);
  assert.deepEqual(archive[0]!.colors, ['Black', 'Blue']);
});
