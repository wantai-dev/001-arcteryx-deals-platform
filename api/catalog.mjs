import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { publicSupabaseConfig } from './product.mjs';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadGearBrands() {
  const candidates = [
    path.join(API_DIR, '..', 'gear-brands.js'),
    path.join(API_DIR, '..', 'static', 'gear-brands.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('GearDrop brand runtime is unavailable');
}

const GearBrands = loadGearBrands();
const CATALOG_FIELDS = [
  'sku_id', 'brand', 'model', 'full_name', 'description', 'category', 'color',
  'original_price', 'sale_price', 'discount_pct', 'currency', 'symbol',
  'gender', 'image_url', 'region', 'url', 'dealer', 'last_updated',
  'first_seen', 'status', 'last_seen_at', 'url_http_status', 'sizes', 'size_stock',
].join(',');

const PAGE_SIZE = 60;
const MAX_PAGE = 10_000;
const FETCH_PAGE_SIZE = 1_000;
const MAX_CATALOG_ROWS = 60_000;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const STALE_CACHE_MS = 60 * 60 * 1_000;
const SORTS = new Set(['discount_desc', 'price_asc', 'price_desc', 'recent', 'recent_asc']);
const FILTER_KEYS = ['brand', 'platform', 'region', 'gender', 'category', 'series'];
const SAFE_FILTER = /^[\p{L}\p{N} .,'’&+()/_-]{1,80}$/u;
const RATES = {
  USD: 7.25, EUR: 7.85, GBP: 9.15, CAD: 5.30,
  AUD: 4.70, CHF: 8.20, SEK: 0.70, DKK: 1.05, NOK: 0.68, JPY: 0.048,
};
const SYMBOL_TO_CCY = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', 'C$': 'CAD',
  'A$': 'AUD', CHF: 'CHF', kr: 'SEK', '¥': 'JPY',
};

let catalogCache = null;
let catalogRefresh = null;

class CatalogRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogRequestError';
  }
}

function parseMaybeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeTimestamp(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 19);
}

function platformKey(product) {
  if (product.dealer) return String(product.dealer).toLowerCase();
  const url = String(product.url || '').toLowerCase();
  if (url.includes('outlet.arcteryx.com')) return 'arcteryx_outlet';
  if (url.includes('ssense.com')) return 'ssense';
  if (url.includes('mec.ca')) return 'mec';
  if (url.includes('evo.com')) return 'evo';
  if (url.includes('burton.com')) return 'burton';
  if (url.includes('rei.com')) return 'rei';
  if (url.includes('backcountry')) return 'backcountry';
  if (url.includes('steepandcheap')) return 'steepandcheap';
  return 'arcteryx_outlet';
}

function allKnownSizesOutOfStock(product) {
  const sizes = parseMaybeJson(product.sizes, []);
  const stock = parseMaybeJson(product.size_stock, {});
  const keys = Array.isArray(sizes) && sizes.length ? sizes : Object.keys(stock || {});
  if (!keys.length) return false;
  return keys.every((size) => (stock || {})[size] === 'out_of_stock');
}

function isVisibleProduct(product) {
  if (!GearBrands.isSupportedBrandProduct(product)) return false;
  const dealer = platformKey(product);
  if (product.status && product.status !== 'active') return false;
  if (dealer === 'ssense') return false;
  if (dealer !== 'arcteryx_outlet') return true;
  const url = String(product.url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
  if (/outlet\.arcteryx\.com\/(?:[a-z]{2}\/[a-z]{2}\/)?shop\/womens\/rush-bib-pant$/.test(url)) {
    return false;
  }
  return !allKnownSizesOutOfStock(product);
}

function inferCategory(name, urlValue) {
  const nameValue = String(name || '').toLowerCase();
  const url = String(urlValue || '').toLowerCase();
  if (/snowboard|splitboard|powder board/.test(nameValue) || /snowboards?/.test(url)) return '滑雪板';
  if (/binding/.test(nameValue) || /bindings?/.test(url)) return '固定器';
  if (/veilance/.test(nameValue) || /veilance/.test(url)) return 'Veilance';
  if (/shoe|boot|sandal|kragg|konseal|aerios|bora|acrux|vertex|kopec|norvan\s*sl|sylan/.test(nameValue)) return '鞋类';
  if (/\bpack\b|backpack|bag|mantis|arro|brize|khard|\bindex\b/.test(nameValue)) return '背包';
  if (/\bpants?\b|bib\s*pants?|bib\s*shorts?|\bshorts?\b|leggings?|tights?|\bliner\b|trousers?/.test(nameValue)) return '裤装';
  if (/one\s*piece|onesie|coverall/.test(nameValue)) return '连体雪衣';
  if (/harness|belay|carabiner|sling|rope|cordelette/.test(nameValue)) return '攀岩装备';
  if (/bandana|belt|visor|conveyor|scarf|gaiter|sleeve/.test(nameValue)) return '配饰';
  if (/down\s*jacket|insulated\s*jacket|cerium|thorium|nuclei|calidum|proton\s*lt\s*j/.test(nameValue)) return '保暖羽绒';
  if (/jacket|shell/.test(nameValue)) return '冲锋衣';
  if (/hoody|hoodie|fleece|zip.*neck|pullover|crew|cardigan|sweater/.test(nameValue)) return '卫衣/抓绒';
  if (/\btee\b|t-shirt|\bshirt\b|\bpolo\b/.test(nameValue)) return '上衣';
  if (/glove|mitt/.test(nameValue)) return '手套';
  if (/\bhat\b|toque|beanie|\bcap\b|headband/.test(nameValue)) return '帽子';
  if (/brief|boxer|base.?layer/.test(nameValue)) return '内衣';
  return '其他';
}

function decorateProduct(row) {
  const product = {
    ...row,
    last_updated: normalizeTimestamp(row.last_updated),
    sizes: parseMaybeJson(row.sizes, []),
    size_stock: parseMaybeJson(row.size_stock, {}),
  };
  const brand = GearBrands.productBrand(product);
  const name = GearBrands.standardProductName(product.full_name || product.model, product);
  const category = product.category && product.category !== '其他'
    ? product.category : inferCategory(name, product.url);
  return {
    ...product,
    _brand: brand,
    _platform: platformKey(product),
    _series: GearBrands.productSeries(name, product) || '其他',
    _category: category,
    _search: [
      GearBrands.brandLabel(brand), name, product.full_name, product.model,
      product.description, product.category, category,
    ].filter(Boolean).join(' ').normalize('NFKC').toLowerCase(),
  };
}

function publicProduct(product) {
  const { _search, ...value } = product;
  return value;
}

function toCny(product) {
  const price = Number(product.sale_price);
  if (!Number.isFinite(price)) return Number.POSITIVE_INFINITY;
  const currency = String(product.currency || SYMBOL_TO_CCY[product.symbol] || 'USD').toUpperCase();
  return price * (RATES[currency] || RATES.USD);
}

function parsePositiveInteger(value, fallback, maximum, label) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new CatalogRequestError(`Invalid ${label}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new CatalogRequestError(`Invalid ${label}`);
  }
  return number;
}

function parseCatalogRequest(urlValue) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue || '/', 'https://local.invalid');
  const request = {
    q: String(url.searchParams.get('q') || '').trim().normalize('NFKC'),
    sort: String(url.searchParams.get('sort') || 'discount_desc'),
    page: parsePositiveInteger(url.searchParams.get('page'), 1, MAX_PAGE, 'page'),
    limit: parsePositiveInteger(url.searchParams.get('limit'), PAGE_SIZE, PAGE_SIZE, 'limit'),
    since: String(url.searchParams.get('since') || ''),
  };
  if (request.q.length > 100 || /[\u0000-\u001f\u007f]/.test(request.q)) {
    throw new CatalogRequestError('Invalid q');
  }
  if (!SORTS.has(request.sort)) throw new CatalogRequestError('Invalid sort');
  if (request.since && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(request.since)) {
    throw new CatalogRequestError('Invalid since');
  }
  for (const key of FILTER_KEYS) {
    const value = String(url.searchParams.get(key) || 'all').trim().normalize('NFKC');
    if (value !== 'all' && !SAFE_FILTER.test(value)) throw new CatalogRequestError(`Invalid ${key}`);
    request[key] = value;
  }
  return request;
}

function matches(product, request, excludedFacet = '') {
  if (excludedFacet !== 'brand' && request.brand !== 'all' && product._brand !== request.brand) return false;
  if (excludedFacet !== 'platform' && request.platform !== 'all' && product._platform !== request.platform) return false;
  if (excludedFacet !== 'region' && request.region !== 'all' && product.region !== request.region) return false;
  if (excludedFacet !== 'gender' && request.gender !== 'all' && product.gender !== request.gender) return false;
  if (excludedFacet !== 'category' && request.category !== 'all' && product._category !== request.category) return false;
  if (excludedFacet !== 'series' && request.series !== 'all' && product._series !== request.series) return false;
  if (request.q && !product._search.includes(request.q.toLowerCase())) return false;
  return true;
}

function sortProducts(rows, sort) {
  const sorted = rows.slice();
  const bySku = (left, right) => String(left.sku_id || '').localeCompare(String(right.sku_id || ''));
  switch (sort) {
    case 'price_asc':
      sorted.sort((left, right) => toCny(left) - toCny(right) || bySku(left, right));
      break;
    case 'price_desc':
      sorted.sort((left, right) => toCny(right) - toCny(left) || bySku(left, right));
      break;
    case 'recent':
      sorted.sort((left, right) => String(right.last_updated || '').localeCompare(String(left.last_updated || '')) || bySku(left, right));
      break;
    case 'recent_asc':
      sorted.sort((left, right) => String(left.last_updated || '').localeCompare(String(right.last_updated || '')) || bySku(left, right));
      break;
    case 'discount_desc':
    default:
      sorted.sort((left, right) => (Number(right.discount_pct) || 0) - (Number(left.discount_pct) || 0) || bySku(left, right));
  }
  return sorted;
}

function facet(rows, request, key, getter) {
  const pool = rows.filter((product) => matches(product, request, key));
  const counts = {};
  for (const product of pool) {
    const value = getter(product);
    if (value == null || value === '') continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return { total: pool.length, counts };
}

function queryCatalog(rows, request, metadata = {}) {
  const filtered = rows.filter((product) => matches(product, request));
  const sorted = sortProducts(filtered, request.sort);
  const pageCount = Math.max(1, Math.ceil(sorted.length / request.limit));
  const page = Math.min(request.page, pageCount);
  const start = (page - 1) * request.limit;
  const pageRows = sorted.slice(start, start + request.limit);
  const averageDiscount = filtered.length
    ? Math.round(filtered.reduce((sum, product) => sum + (Number(product.discount_pct) || 0), 0) / filtered.length)
    : 0;
  const lastUpdated = rows.reduce(
    (latest, product) => String(product.last_updated || '') > latest ? String(product.last_updated) : latest,
    '',
  );
  const maxDiscount = rows.reduce(
    (maximum, product) => Math.max(maximum, Number(product.discount_pct) || 0),
    0,
  );

  let newArrivals = { count: 0, rows: [], suppressed: false };
  if (request.since) {
    const since = Date.parse(request.since);
    const recent = rows.filter((product) => {
      if (request.region !== 'all' && product.region !== request.region) return false;
      const firstSeen = Date.parse(product.first_seen || '');
      return Number.isFinite(firstSeen) && firstSeen >= since;
    });
    newArrivals = {
      count: recent.length,
      suppressed: recent.length > 200,
      rows: recent.length > 200
        ? []
        : sortProducts(recent, 'discount_desc').slice(0, 12).map(publicProduct),
    };
  }

  return {
    code_revision: metadata.codeRevision || 'development',
    data_revision: metadata.dataRevision || 'unknown',
    stale: Boolean(metadata.stale),
    page,
    page_size: request.limit,
    page_count: pageCount,
    total: filtered.length,
    average_discount: averageDiscount,
    rows: pageRows.map(publicProduct),
    facets: {
      brand: facet(rows, request, 'brand', (product) => product._brand),
      platform: facet(rows, request, 'platform', (product) => product._platform),
      region: facet(rows, request, 'region', (product) => product.region),
      gender: facet(rows, request, 'gender', (product) => product.gender),
      category: facet(rows, request, 'category', (product) => product._category),
      series: facet(rows, request, 'series', (product) => product._series),
    },
    catalog: {
      total: rows.length,
      max_discount: maxDiscount,
      last_updated: lastUpdated,
    },
    new_arrivals: newArrivals,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchCatalogPage(url, anonKey, fetchImpl) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Catalog response was not an array');
      return rows;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(200 * (2 ** attempt));
    }
  }
  throw lastError || new Error('Catalog request failed');
}

async function fetchCatalogRows(fetchImpl = fetch) {
  const [supabaseUrl, anonKey] = publicSupabaseConfig();
  const allRows = [];
  for (let offset = 0; offset < MAX_CATALOG_ROWS; offset += FETCH_PAGE_SIZE) {
    const url = new URL('/rest/v1/products', supabaseUrl);
    url.searchParams.set('select', CATALOG_FIELDS);
    url.searchParams.set('status', 'eq.active');
    url.searchParams.set('order', 'sku_id.asc');
    url.searchParams.set('limit', String(FETCH_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const rows = await fetchCatalogPage(url, anonKey, fetchImpl);
    allRows.push(...rows);
    if (rows.length < FETCH_PAGE_SIZE) break;
    if (offset + FETCH_PAGE_SIZE >= MAX_CATALOG_ROWS) {
      throw new Error(`Catalog exceeded ${MAX_CATALOG_ROWS} rows`);
    }
  }
  return allRows.filter(isVisibleProduct).map(decorateProduct);
}

function codeRevision() {
  if (process.env.GEARDROP_CODE_REVISION) return process.env.GEARDROP_CODE_REVISION;
  try {
    return fs.readFileSync(path.join(API_DIR, '..', 'REVISION'), 'utf8').trim() || 'unknown';
  } catch (_) {
    return 'development';
  }
}

function stableRevisionValue(value) {
  if (Array.isArray(value)) return value.map(stableRevisionValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableRevisionValue(value[key])]),
    );
  }
  return value;
}

function dataRevision(rows) {
  const hash = crypto.createHash('sha256');
  hash.update(`rows=${rows.length}\n`);
  const ordered = rows
    .map((product) => stableRevisionValue(publicProduct(product)))
    .map((product) => ({
      sku: String(product.sku_id || ''),
      serialized: JSON.stringify(product),
    }))
    .sort((left, right) => left.sku < right.sku ? -1 : left.sku > right.sku ? 1
      : left.serialized < right.serialized ? -1 : left.serialized > right.serialized ? 1 : 0);
  for (const product of ordered) {
    hash.update(`${product.serialized}\n`);
  }
  return hash.digest('hex').slice(0, 20);
}

async function loadCatalog(fetchImpl = fetch, now = Date.now()) {
  if (catalogCache && now - catalogCache.loadedAt < CACHE_TTL_MS) {
    return { ...catalogCache, stale: false };
  }
  if (!catalogRefresh) {
    catalogRefresh = (async () => {
      const rows = await fetchCatalogRows(fetchImpl);
      catalogCache = {
        rows,
        loadedAt: Date.now(),
        codeRevision: codeRevision(),
        dataRevision: dataRevision(rows),
      };
      return { ...catalogCache, stale: false };
    })().catch((error) => {
      if (catalogCache && now - catalogCache.loadedAt < STALE_CACHE_MS) {
        console.error('catalog_refresh_failed_serving_stale', error);
        return { ...catalogCache, stale: true };
      }
      throw error;
    }).finally(() => {
      catalogRefresh = null;
    });
  }
  return catalogRefresh;
}

function sendJson(req, res, status, value, cacheControl = 'no-store', etag = '') {
  const body = value == null ? '' : JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (etag) res.setHeader('ETag', etag);
  res.end(req.method === 'HEAD' || status === 304 ? '' : body);
}

async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, HEAD');
    return sendJson(req, res, 405, { error: 'method_not_allowed' });
  }
  let request;
  try {
    request = parseCatalogRequest(req.url || '/api/catalog');
  } catch (error) {
    if (error instanceof CatalogRequestError) {
      return sendJson(req, res, 400, { error: 'invalid_request' });
    }
    throw error;
  }

  try {
    const snapshot = await loadCatalog();
    const payload = queryCatalog(snapshot.rows, request, snapshot);
    const etagValue = crypto.createHash('sha256')
      .update(`${snapshot.dataRevision}\n${JSON.stringify(request)}\n`)
      .digest('base64url');
    const etag = `"${etagValue}"`;
    res.setHeader('X-Code-Revision', snapshot.codeRevision);
    res.setHeader('X-Data-Revision', snapshot.dataRevision);
    if (snapshot.stale) res.setHeader('X-Catalog-Stale', '1');
    if (req.headers?.['if-none-match'] === etag) {
      return sendJson(req, res, 304, null, 'public, max-age=30, stale-while-revalidate=300', etag);
    }
    return sendJson(
      req,
      res,
      200,
      payload,
      'public, max-age=30, stale-while-revalidate=300',
      etag,
    );
  } catch (error) {
    console.error('catalog_handler_failed', error);
    return sendJson(req, res, 503, { error: 'catalog_unavailable' });
  }
}

function resetCatalogCache() {
  catalogCache = null;
  catalogRefresh = null;
}

export {
  CATALOG_FIELDS,
  PAGE_SIZE,
  CatalogRequestError,
  codeRevision,
  dataRevision,
  decorateProduct,
  fetchCatalogRows,
  isVisibleProduct,
  parseCatalogRequest,
  queryCatalog,
  resetCatalogCache,
};
export default handler;
