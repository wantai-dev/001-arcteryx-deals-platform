import type {
  CatalogBrandKey,
  CatalogGender,
  CatalogProduct,
  CatalogProductRow,
  Product,
} from './types';
import { productCategory, productName } from './catalog';
import { convertAmount, type CurrencyPreference, type RateSnapshot } from './currency';
import { normalizeSearchText } from './search';

type BrandRule = {
  label: string;
  country: string;
  currency: string;
  sourceName: string;
  validId: (value: string) => boolean;
  validUrl: (url: URL) => boolean;
};

const STYLE_ID = /^[0-9A-Z][0-9A-Z._-]{1,63}$/;

export const YEARBOOK_BRAND_RULES: Record<CatalogBrandKey, BrandRule> = {
  arcteryx: {
    label: "Arc'teryx",
    country: 'us',
    currency: 'USD',
    sourceName: 'arcteryx_us_official_product_feed',
    validId: (value) => /^X[0-9A-Z]{6,}$/.test(value),
    validUrl: (url) => url.hostname === 'arcteryx.com' && url.pathname.startsWith('/us/en/shop/'),
  },
  burton: {
    label: 'Burton',
    country: 'us',
    currency: 'USD',
    sourceName: 'burton_us_official_collection_json',
    validId: (value) => STYLE_ID.test(value),
    validUrl: (url) => url.hostname === 'www.burton.com' && url.pathname.startsWith('/en-us/products/'),
  },
  patagonia: {
    label: 'Patagonia',
    country: 'au',
    currency: 'AUD',
    sourceName: 'patagonia_au_official_collection_json',
    validId: (value) => STYLE_ID.test(value),
    validUrl: (url) => url.hostname === 'www.patagonia.com.au' && url.pathname.startsWith('/products/'),
  },
};

export type YearbookFilters = {
  query?: string;
  brand?: CatalogBrandKey | 'all';
  gender?: CatalogGender | 'all';
  category?: string | 'all';
  year?: number | 'all';
};

export type YearbookMatchCounts = {
  official_id: number;
  exact_name: number;
  unmatched: number;
};

export type YearbookDealIndex = {
  byCatalogId: Record<string, Product[]>;
  unmatched: Product[];
  matchCounts: YearbookMatchCounts;
};

export type YearbookArchiveStyle = {
  archive_id: string;
  brand_key: CatalogBrandKey;
  official_product_id: string | null;
  name: string;
  gender: CatalogGender;
  categories: string[];
  colors: string[];
  offers: Product[];
};

function strings(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function sourceMap(value: Record<string, string> | string | null): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key.trim(), String(item).trim()])
        .filter(([key, item]) => Boolean(key && item)),
    );
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? sourceMap(parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: number | string | null): number | null {
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validDate(value: string | null): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

function brandKey(value: string | null): CatalogBrandKey | null {
  return value === 'arcteryx' || value === 'burton' || value === 'patagonia' ? value : null;
}

function genderValue(value: string | null): CatalogGender | null {
  return value === 'men' || value === 'women' || value === 'kids' || value === 'unisex' ? value : null;
}

function isOfficialUrl(rule: BrandRule, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && rule.validUrl(url);
  } catch {
    return false;
  }
}

export function normalizeCatalogProduct(row: CatalogProductRow): CatalogProduct | null {
  const normalizedBrand = brandKey(row.brand_key);
  const gender = genderValue(row.gender);
  const officialId = row.official_product_id?.trim().toUpperCase() || '';
  const catalogId = row.catalog_product_id?.trim().toLowerCase() || '';
  const name = row.name?.trim() || '';
  const sourceUrl = row.source_url?.trim() || '';
  const listPrice = finiteNumber(row.list_price);
  const listPriceMax = finiteNumber(row.list_price_max);
  if (!normalizedBrand || !gender || !name || listPrice === null || listPriceMax === null || listPriceMax < listPrice) return null;
  const rule = YEARBOOK_BRAND_RULES[normalizedBrand];
  if (
    row.brand !== rule.label
    || row.catalog_scope !== 'full_price'
    || row.country !== rule.country
    || row.currency !== rule.currency
    || row.language !== 'en'
    || row.source_name !== rule.sourceName
    || row.status !== 'active'
    || !rule.validId(officialId)
    || catalogId !== `${normalizedBrand}:${officialId.toLowerCase()}`
    || !isOfficialUrl(rule, sourceUrl)
    || !/^[0-9a-f]{64}$/.test(row.source_hash || '')
    || !validDate(row.first_seen_at)
    || !validDate(row.last_seen_at)
    || !validDate(row.last_changed_at)
  ) return null;
  return {
    catalog_product_id: catalogId,
    brand_key: normalizedBrand,
    official_product_id: officialId,
    brand: rule.label,
    catalog_scope: 'full_price',
    market: row.market?.trim() || 'outdoor',
    country: rule.country,
    language: 'en',
    name,
    gender,
    collection: row.collection?.trim() || null,
    categories: strings(row.categories),
    category_sources: sourceMap(row.category_sources),
    list_price: listPrice,
    list_price_max: listPriceMax,
    currency: rule.currency,
    color_names: strings(row.color_names),
    primary_colors: strings(row.primary_colors),
    season_codes: strings(row.season_codes),
    source_name: rule.sourceName,
    source_url: sourceUrl,
    source_hash: row.source_hash || '',
    status: 'active',
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    last_changed_at: row.last_changed_at,
  };
}

export function yearbookYear(product: CatalogProduct): number {
  const seasonYears = product.season_codes
    .map((value) => /^[FSW](\d{2})$/i.exec(value)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => 2000 + Number(value));
  return seasonYears.length ? Math.max(...seasonYears) : new Date(product.first_seen_at).getUTCFullYear();
}

export function filterYearbookProducts(products: CatalogProduct[], filters: YearbookFilters): CatalogProduct[] {
  const query = normalizeSearchText(filters.query || '');
  return products.filter((product) => {
    if (filters.brand && filters.brand !== 'all' && product.brand_key !== filters.brand) return false;
    if (filters.gender && filters.gender !== 'all' && product.gender !== filters.gender) return false;
    if (filters.category && filters.category !== 'all' && !product.categories.includes(filters.category)) return false;
    if (filters.year && filters.year !== 'all' && yearbookYear(product) !== filters.year) return false;
    if (!query) return true;
    const searchable = [
      product.name,
      product.brand,
      product.official_product_id,
      product.collection || '',
      ...product.categories,
      ...product.color_names,
      ...product.primary_colors,
    ].join(' ');
    return normalizeSearchText(searchable).includes(query);
  });
}

export function yearbookBrands(products: CatalogProduct[]): CatalogBrandKey[] {
  const present = new Set(products.map((product) => product.brand_key));
  return (['arcteryx', 'burton', 'patagonia'] as CatalogBrandKey[]).filter((brand) => present.has(brand));
}

export function yearbookYears(products: CatalogProduct[]): number[] {
  return [...new Set(products.map(yearbookYear))].sort((a, b) => b - a);
}

export function yearbookCategories(products: CatalogProduct[]): string[] {
  return [...new Set(products.flatMap((product) => product.categories))].sort((a, b) => a.localeCompare(b));
}

export function categoryLabel(value: string): string {
  return value.split('-').map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : '').join(' ');
}

export function brandLabel(value: CatalogBrandKey): string {
  return YEARBOOK_BRAND_RULES[value].label;
}

export function formatCatalogPrice(product: CatalogProduct, locale = product.country === 'au' ? 'en-AU' : 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: product.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const minimum = formatter.format(product.list_price);
  return product.list_price_max > product.list_price
    ? `${minimum}–${formatter.format(product.list_price_max)}`
    : minimum;
}

export function yearbookFreshnessLabel(lastUpdated: string | null | undefined, locale: string, now = Date.now()): string {
  if (!lastUpdated) return '';
  const normalized = lastUpdated.includes('T') ? lastUpdated : lastUpdated.replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(normalized) ? normalized : `${normalized}Z`;
  const stamp = Date.parse(zoned);
  if (!Number.isFinite(stamp)) return '';
  const days = Math.max(0, Math.floor((now - stamp) / 86_400_000));
  const RelativeTimeFormatter = Intl.RelativeTimeFormat;
  if (typeof RelativeTimeFormatter === 'function') {
    try {
      return new RelativeTimeFormatter(locale, { numeric: 'auto' }).format(-days, 'day');
    } catch {
      // Hermes builds can omit or partially implement RelativeTimeFormat.
    }
  }
  const language = locale.toLocaleLowerCase();
  if (language.startsWith('zh')) return days === 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
  if (language.startsWith('de')) return days === 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`;
  if (language.startsWith('fr')) return days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} jours`;
  if (language.startsWith('ja')) return days === 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`;
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function isDiscounted(product: Product): boolean {
  return Number.isFinite(product.sale_price)
    && Number.isFinite(product.original_price)
    && product.sale_price > 0
    && product.original_price > product.sale_price + 0.01
    && product.discount_pct > 0;
}

function audience(name: string, fallback: string | null | undefined): CatalogGender {
  const value = name.normalize('NFKC').toLocaleLowerCase().replace(/[’]/g, "'");
  if (/\b(?:kids?|youth|toddlers?|baby|babies|boys?|girls?)['’]?\b/.test(value)) return 'kids';
  if (/\b(?:women|womens|woman|female)(?:'s)?\b/.test(value)) return 'women';
  if (/\b(?:men|mens|man|male)(?:'s)?\b/.test(value)) return 'men';
  if (fallback === 'kids' || fallback === 'women' || fallback === 'men') return fallback;
  return 'unisex';
}

function normalizedStyleName(value: string): string {
  const singular: Record<string, string> = {
    bibs: 'bib',
    bindings: 'binding',
    boots: 'boot',
    gloves: 'glove',
    mittens: 'mitten',
    pants: 'pant',
    socks: 'sock',
  };
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/arc[\s-]*[’'`]?teryx|patagonia|burton/g, ' ')
    .replace(/gore[\s\u2010-\u2015-]*tex/g, 'gore tex')
    .replace(/step[\s\u2010-\u2015-]*on/g, 'step on')
    .replace(/\b(?:women|womens|woman|female|men|mens|man|male|unisex)(?:['’]?s)?\b/g, ' ')
    .replace(/\b(?:kids?|youth|toddlers?|baby|babies|boys?|girls?)(?:['’]?s)?\b/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => singular[token] || token)
    .join(' ');
}

function styleNameKey(brand: CatalogBrandKey, name: string, gender: string | null | undefined): string | null {
  const normalizedName = normalizedStyleName(name);
  return normalizedName ? `${brand}|${audience(name, gender)}|${normalizedName}` : null;
}

function validOfficialId(brand: CatalogBrandKey, value: string): boolean {
  if (brand === 'arcteryx') return /^X[0-9A-Z][0-9A-Z._-]{5,62}$/.test(value);
  return STYLE_ID.test(value);
}

function officialIdFromUrl(product: Product): string | null {
  let parsed: URL;
  try {
    parsed = new URL(product.url || '');
  } catch {
    return null;
  }
  const host = parsed.hostname.toLocaleLowerCase();
  const handle = decodeURIComponent(parsed.pathname).replace(/\/$/, '').split('/').pop() || '';
  if (product._brand === 'arcteryx' && /(?:^|\.)arcteryx\.com$/.test(host)) {
    const digits = /-(\d{4,5})$/.exec(handle)?.[1];
    return digits ? `X${digits.padStart(9, '0')}` : null;
  }
  if (product._brand === 'burton' && /(?:^|\.)burton\.com$/.test(host)) {
    return /-(\d{6})(?:-[a-z0-9]+)*$/i.exec(handle)?.[1] || null;
  }
  if (product._brand === 'patagonia' && /(?:^|\.)patagonia\.com\.au$/.test(host)) {
    return /-(\d{5})(?:-[a-z0-9]{2,12})?$/i.exec(handle)?.[1] || null;
  }
  return null;
}

function dealOfficialId(product: Product): string | null {
  const explicit = String(product.official_product_id || '').trim().toUpperCase();
  if (explicit) return validOfficialId(product._brand, explicit) ? explicit : null;
  const parsed = officialIdFromUrl(product);
  return parsed && validOfficialId(product._brand, parsed) ? parsed : null;
}

function offerOrder(left: Product, right: Product): number {
  return left.currency.localeCompare(right.currency)
    || left.sale_price - right.sale_price
    || right.discount_pct - left.discount_pct
    || left.sku_id.localeCompare(right.sku_id);
}

export function indexYearbookDeals(catalog: CatalogProduct[], deals: Product[]): YearbookDealIndex {
  const catalogById = new Map(catalog.map((product) => [product.catalog_product_id, product]));
  const catalogByName = new Map<string, CatalogProduct[]>();
  for (const product of catalog) {
    const key = styleNameKey(product.brand_key, product.name, product.gender);
    if (!key) continue;
    const values = catalogByName.get(key) || [];
    values.push(product);
    catalogByName.set(key, values);
  }

  const byCatalogId: Record<string, Product[]> = {};
  const unmatched: Product[] = [];
  const matchCounts: YearbookMatchCounts = { official_id: 0, exact_name: 0, unmatched: 0 };
  for (const deal of deals) {
    if (!isDiscounted(deal)) continue;
    const officialId = dealOfficialId(deal);
    let target: CatalogProduct | null = null;
    let method: keyof Omit<YearbookMatchCounts, 'unmatched'> | null = null;
    if (officialId) {
      target = catalogById.get(`${deal._brand}:${officialId.toLocaleLowerCase()}`) || null;
      if (target) method = 'official_id';
    } else {
      const nameKey = styleNameKey(deal._brand, productName(deal), deal.gender);
      const candidates = nameKey ? catalogByName.get(nameKey) || [] : [];
      if (candidates.length === 1) {
        target = candidates[0] ?? null;
        method = 'exact_name';
      }
    }
    if (!target || !method) {
      unmatched.push(deal);
      matchCounts.unmatched += 1;
      continue;
    }
    (byCatalogId[target.catalog_product_id] ||= []).push(deal);
    matchCounts[method] += 1;
  }
  for (const offers of Object.values(byCatalogId)) offers.sort(offerOrder);
  unmatched.sort(offerOrder);
  return { byCatalogId, unmatched, matchCounts };
}

export function bestYearbookOffers(offers: Product[], preferredCurrency?: string): Product[] {
  const byCurrency = new Map<string, Product>();
  for (const offer of offers.filter(isDiscounted)) {
    const currency = offer.currency.toUpperCase();
    const current = byCurrency.get(currency);
    if (!current || offerOrder(offer, current) < 0) byCurrency.set(currency, offer);
  }
  return [...byCurrency.values()].sort((left, right) => {
    const leftPreferred = left.currency === preferredCurrency ? 0 : 1;
    const rightPreferred = right.currency === preferredCurrency ? 0 : 1;
    return leftPreferred - rightPreferred || left.currency.localeCompare(right.currency) || offerOrder(left, right);
  });
}

export type ComparableYearbookOffer = {
  offer: Product | null;
  comparableAcrossCurrencies: boolean;
};

export function comparableYearbookOffer(
  offers: Product[],
  targetCurrency: CurrencyPreference,
  snapshot: RateSnapshot | null,
): ComparableYearbookOffer {
  const candidates = bestYearbookOffers(offers, targetCurrency === 'original' ? undefined : targetCurrency);
  if (!candidates.length) return { offer: null, comparableAcrossCurrencies: true };
  if (candidates.length === 1) return { offer: candidates[0]!, comparableAcrossCurrencies: true };

  const comparisonCurrency = targetCurrency === 'original' ? 'EUR' : targetCurrency;
  const converted = candidates.map((offer) => {
    const result = convertAmount(offer.sale_price, offer.currency, comparisonCurrency, snapshot);
    return { offer, value: result.currency === comparisonCurrency ? result.value : null };
  });
  if (converted.some(({ value }) => value === null)) {
    return { offer: candidates[0]!, comparableAcrossCurrencies: false };
  }
  converted.sort((left, right) => left.value! - right.value! || left.offer.sku_id.localeCompare(right.offer.sku_id));
  return { offer: converted[0]!.offer, comparableAcrossCurrencies: true };
}

export function groupYearbookArchive(products: Product[]): YearbookArchiveStyle[] {
  const groups = new Map<string, Product[]>();
  for (const product of products.filter(isDiscounted)) {
    const officialId = dealOfficialId(product);
    const fallbackName = normalizedStyleName(productName(product));
    const key = officialId
      ? `${product._brand}:${officialId.toLocaleLowerCase()}`
      : `${product._brand}:name:${audience(productName(product), product.gender)}:${fallbackName || product.sku_id}`;
    const values = groups.get(key) || [];
    values.push(product);
    groups.set(key, values);
  }

  return [...groups.entries()].map(([archiveId, offers]) => {
    const sortedOffers = [...offers].sort(offerOrder);
    const names = [...new Set(sortedOffers.map(productName).filter(Boolean))]
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    const representative = sortedOffers[0]!;
    const officialId = dealOfficialId(representative);
    const colors = [...new Set(sortedOffers.flatMap((offer) => String(offer.color || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)))].sort((left, right) => left.localeCompare(right));
    const categories = [...new Set(sortedOffers.map(productCategory).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    return {
      archive_id: archiveId,
      brand_key: representative._brand,
      official_product_id: officialId,
      name: names[0] || representative.sku_id,
      gender: audience(names[0] || '', representative.gender),
      categories,
      colors,
      offers: sortedOffers,
    };
  }).sort((left, right) => left.brand_key.localeCompare(right.brand_key) || left.name.localeCompare(right.name));
}

export function filterYearbookArchive(
  products: YearbookArchiveStyle[],
  filters: Omit<YearbookFilters, 'year'>,
): YearbookArchiveStyle[] {
  const query = normalizeSearchText(filters.query || '');
  return products.filter((product) => {
    if (filters.brand && filters.brand !== 'all' && product.brand_key !== filters.brand) return false;
    if (filters.gender && filters.gender !== 'all' && product.gender !== filters.gender) return false;
    if (filters.category && filters.category !== 'all' && !product.categories.includes(filters.category)) return false;
    if (!query) return true;
    const searchable = [
      product.brand_key,
      brandLabel(product.brand_key),
      product.name,
      product.official_product_id || '',
      ...product.categories,
      ...product.colors,
      ...product.offers.map((offer) => offer._platform),
    ].join(' ');
    return normalizeSearchText(searchable).includes(query);
  });
}
