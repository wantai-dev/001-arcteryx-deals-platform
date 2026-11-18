import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bestYearbookOffers,
  comparableYearbookOffer,
  filterYearbookArchive,
  filterYearbookProducts,
  formatCatalogPrice,
  formatOfficialPrice,
  groupYearbookArchive,
  indexRegionalPrices,
  indexYearbookDeals,
  normalizeCatalogProduct,
  normalizeRegionalPrice,
  offerImageUris,
  officialPriceFor,
  otherOfficialPriceLabels,
  otherOfficialPrices,
  yearbookBrands,
  yearbookCategories,
  yearbookFreshnessLabel,
  yearbookRegionOptions,
  yearbookYear,
  yearbookYears,
} from '../lib/yearbook';
import type { CatalogProductRow, CatalogRegionalPriceRow, Product } from '../lib/types';

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


function regionalRow(country: string, currency: string, price: number, overrides: Partial<CatalogRegionalPriceRow> = {}): CatalogRegionalPriceRow {
  return {
    catalog_product_id: 'arcteryx:x000009715',
    country,
    currency,
    list_price: price,
    list_price_max: price,
    source_url: `https://arcteryx.com/${country}/en/shop/mens/vertex-speed-low-shoe-9715`,
    status: 'active',
    ...overrides,
  };
}

test('normalizes regional official prices and rejects mismatched currencies or shops', () => {
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'GBP', 150))?.list_price, 150);
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'EUR', 150)), null);
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'GBP', 150, { source_url: 'https://arcteryx.com/us/en/shop/x' })), null);
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'GBP', 150, { status: 'missing' })), null);
  assert.equal(normalizeRegionalPrice(regionalRow('jp', 'JPY', 150)), null);
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'GBP', 150, { catalog_product_id: 'burton:x' })), null);
});

test('shows the shopper region official price and falls back to the canonical market', () => {
  const product = normalizeCatalogProduct(arcRow())!;
  const index = indexRegionalPrices([
    normalizeRegionalPrice(regionalRow('us', 'USD', 180))!,
    normalizeRegionalPrice(regionalRow('gb', 'GBP', 150))!,
  ]);
  assert.equal(officialPriceFor(product, index, 'gb').currency, 'GBP');
  assert.equal(officialPriceFor(product, index, 'GB').list_price, 150);
  for (const region of ['all', 'au', 'de']) {
    const fallback = officialPriceFor(product, index, region);
    assert.equal(fallback.country, 'us');
    assert.equal(fallback.source_url, product.source_url);
  }
});

test('orders other regions cheapest first after conversion and excludes the shown region', () => {
  const product = normalizeCatalogProduct(arcRow())!;
  const index = indexRegionalPrices([
    normalizeRegionalPrice(regionalRow('us', 'USD', 180))!,
    normalizeRegionalPrice(regionalRow('gb', 'GBP', 150))!,
    normalizeRegionalPrice(regionalRow('ca', 'CAD', 230))!,
    normalizeRegionalPrice(regionalRow('de', 'EUR', 180))!,
  ]);
  const snapshot = { base: 'USD', date: '2026-11-17', rates: { USD: 1, GBP: 0.79, CAD: 1.4, EUR: 0.93 } };
  const shown = officialPriceFor(product, index, 'gb');
  const rows = otherOfficialPrices(product, index, shown, 'GBP', snapshot as never);
  // C$230 ≈ £130, US$180 ≈ £142, €180 ≈ £153.
  assert.deepEqual(rows.map((row) => row.price.country), ['ca', 'us', 'de']);
  assert.equal(rows[0]!.converted.currency, 'GBP');
  assert.equal(Math.round(rows[0]!.converted.value), Math.round((230 / 1.4) * 0.79));
  const original = otherOfficialPrices(product, index, shown, 'original', null);
  assert.deepEqual(original.map((row) => row.price.country), ['ca', 'de', 'us']);
  assert.ok(original.every((row) => !row.converted.converted));
});

test('other-region rows keep the local price and show conversion only as a hint', () => {
  const product = normalizeCatalogProduct(arcRow())!;
  const index = indexRegionalPrices([
    normalizeRegionalPrice(regionalRow('us', 'USD', 180))!,
    normalizeRegionalPrice(regionalRow('gb', 'GBP', 150))!,
    normalizeRegionalPrice(regionalRow('ca', 'CAD', 230))!,
  ]);
  const snapshot = { base: 'USD', date: '2026-11-17', rates: { USD: 1, GBP: 0.79, CAD: 1.4, CNY: 7.2 } };
  const shown = officialPriceFor(product, index, 'gb');
  const formatOriginal = (value: number, currency: string) => `${currency} ${value.toFixed(0)}`;
  const [canada] = otherOfficialPrices(product, index, shown, 'CNY', snapshot as never);
  const labels = otherOfficialPriceLabels(canada!, formatOriginal);
  // The local column must stay in CAD even though the shopper picked CNY.
  assert.equal(labels.local, 'CAD 230');
  assert.equal(labels.converted, `≈ CNY ${((230 / 1.4) * 7.2).toFixed(0)}`);
  const [local] = otherOfficialPrices(product, index, shown, 'original', snapshot as never);
  assert.deepEqual(otherOfficialPriceLabels(local!, formatOriginal), { local: 'CAD 230', converted: null });
  assert.equal(
    formatOfficialPrice({ list_price: 100, list_price_max: 140, currency: 'EUR' }, formatOriginal),
    'EUR 100–EUR 140',
  );
});

test('accepts Australia only from the arcteryx.com.au store in AUD', () => {
  const auUrl = 'https://arcteryx.com.au/products/vertex-speed-low-shoe-mens-x00000971501';
  const au = normalizeRegionalPrice(regionalRow('au', 'AUD', 280, { source_url: auUrl }));
  assert.equal(au?.currency, 'AUD');
  assert.equal(au?.source_url, auUrl);
  assert.equal(normalizeRegionalPrice(regionalRow('au', 'USD', 280, { source_url: auUrl })), null);
  // The arcteryx.com country-path shape is not Australia's store.
  assert.equal(normalizeRegionalPrice(regionalRow('au', 'AUD', 280)), null);
  assert.equal(normalizeRegionalPrice(regionalRow('au', 'AUD', 280, { source_url: 'https://evil.example/products/x' })), null);
  // And the AU store URL does not stand in for another country.
  assert.equal(normalizeRegionalPrice(regionalRow('gb', 'GBP', 150, { source_url: auUrl })), null);
  const product = normalizeCatalogProduct(arcRow())!;
  const index = indexRegionalPrices([au!, normalizeRegionalPrice(regionalRow('us', 'USD', 180))!]);
  assert.equal(officialPriceFor(product, index, 'au').list_price, 280);
});

test('collects merchant photos for a style and drops duplicate or non-HTTPS URLs', () => {
  const uris = offerImageUris([
    deal({ sku_id: 'a', image_url: 'https://cdn.example/a.jpg', images: ['https://cdn.example/a-alt.jpg'] }),
    deal({ sku_id: 'b', image_url: 'https://cdn.example/a.jpg', images: [] }),
    deal({ sku_id: 'c', image_url: 'http://cdn.example/insecure.jpg', images: ['   '] }),
    deal({ sku_id: 'd', image_url: null, images: ['https://cdn.example/d.jpg'] }),
  ]);
  assert.deepEqual(uris, [
    'https://cdn.example/a.jpg',
    'https://cdn.example/a-alt.jpg',
    'https://cdn.example/d.jpg',
  ]);
});

test('returns no photo candidates when every linked listing lacks artwork', () => {
  assert.deepEqual(offerImageUris([deal({ image_url: null, images: [] })]), []);
  assert.deepEqual(offerImageUris([]), []);
});

test('a category filter accepts the slug aliases that share one label', () => {
  const rows = [
    normalizeCatalogProduct(arcRow({ categories: ['base-layer'] }))!,
    normalizeCatalogProduct(arcRow({
      catalog_product_id: 'arcteryx:x000009716',
      official_product_id: 'X000009716',
      name: "Rho Crew Neck LS Women's",
      categories: ['baselayers'],
    }))!,
    normalizeCatalogProduct(arcRow({
      catalog_product_id: 'arcteryx:x000009717',
      official_product_id: 'X000009717',
      name: "Beta Jacket Men's",
      categories: ['shell-jackets'],
    }))!,
  ];
  assert.equal(filterYearbookProducts(rows, { category: 'base-layer' }).length, 1);
  assert.equal(filterYearbookProducts(rows, { category: ['base-layer', 'baselayers'] }).length, 2);
  assert.equal(filterYearbookProducts(rows, { category: 'all' }).length, 3);
});

test('Yearbook market options keep priced countries without a running sale', () => {
  const au = normalizeRegionalPrice(regionalRow('au', 'AUD', 660, { source_url: 'https://arcteryx.com.au/products/cerium-hoody-mens-x00001052110' }))!;
  const gb = normalizeRegionalPrice(regionalRow('gb', 'GBP', 150))!;
  const index = indexRegionalPrices([au, gb]);
  // No AU deals: Australia still appears, in the usual market order.
  assert.deepEqual(yearbookRegionOptions(['all', 'us', 'gb', 'de'], index), ['all', 'us', 'gb', 'au', 'de']);
  // Nothing priced: deal regions pass through unchanged.
  assert.deepEqual(yearbookRegionOptions(['all', 'us', 'se'], indexRegionalPrices([])), ['all', 'us', 'se']);
});
