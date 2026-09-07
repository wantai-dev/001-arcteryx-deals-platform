import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SEO_INDEX_POLICY = Object.freeze(require('../seo-index-policy.json'));

const BRAND_PATHS = Object.freeze({
  arcteryx: 'arcteryx',
  burton: 'burton',
  patagonia: 'patagonia',
});

function parseMaybeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function parseObservedTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  return Date.parse(normalized);
}

function effectiveDiscount(product) {
  const declared = Number(product.discount_pct);
  const original = Number(product.original_price);
  const sale = Number(product.sale_price);
  const comparable = Number.isFinite(original) && original > 0 && Number.isFinite(sale) && sale >= 0;
  const computed = comparable && sale < original
    ? Math.round((1 - sale / original) * 100)
    : 0;
  return comparable ? computed : (Number.isFinite(declared) ? declared : 0);
}

function assessProductIndexability(product, evaluatedAt = new Date()) {
  const reasons = [];
  const brand = String(product.brand || '').toLowerCase();
  const dealer = String(product.dealer || 'arcteryx_outlet').toLowerCase();
  const evaluatedMs = evaluatedAt instanceof Date ? evaluatedAt.getTime() : Date.parse(String(evaluatedAt));
  const observedMs = parseObservedTimestamp(product.last_seen_at || product.last_updated);
  const stock = parseMaybeJson(product.size_stock, {});
  const stockValues = stock && typeof stock === 'object' && !Array.isArray(stock)
    ? Object.values(stock)
    : [];

  if (product.status !== 'active') reasons.push('inactive');
  if (!SEO_INDEX_POLICY.supported_brands.includes(brand)) reasons.push('unsupported_brand');
  if (SEO_INDEX_POLICY.retired_dealers.includes(dealer)) reasons.push('retired_dealer');
  if (!String(product.sku_id || '').trim()) reasons.push('missing_sku');
  if (!String(product.full_name || product.model || '').trim()) reasons.push('missing_title');
  if (!(Number.isFinite(Number(product.sale_price)) && Number(product.sale_price) > 0)) reasons.push('missing_price');
  if (!/^[A-Z]{3}$/.test(String(product.currency || '').toUpperCase())) reasons.push('missing_currency');
  if (!normalizeExternalUrl(product.url)) reasons.push('missing_retailer_url');
  if (!normalizeExternalUrl(product.image_url)) reasons.push('missing_image');
  if (Number(product.url_http_status) !== SEO_INDEX_POLICY.required_url_http_status) reasons.push('source_unverified');
  if (effectiveDiscount(product) < SEO_INDEX_POLICY.minimum_discount_pct) reasons.push('discount_below_threshold');
  if (stockValues.length && stockValues.every((value) => value === 'out_of_stock')) reasons.push('out_of_stock');
  if (!Number.isFinite(observedMs)) {
    reasons.push('missing_observation_time');
  } else if (!Number.isFinite(evaluatedMs)) {
    reasons.push('invalid_evaluation_time');
  } else {
    const ageDays = (evaluatedMs - observedMs) / 86_400_000;
    if (ageDays > SEO_INDEX_POLICY.maximum_age_days) reasons.push('stale_observation');
    if (ageDays < -1) reasons.push('future_observation');
  }
  return { eligible: reasons.length === 0, reasons };
}

function brandHubPath(brand, language = 'zh-CN') {
  const slug = BRAND_PATHS[String(brand || '').toLowerCase()];
  if (!slug) return language === 'en-US' ? '/en/' : '/';
  return `${language === 'en-US' ? '/en' : ''}/brands/${slug}.html`;
}

export {
  SEO_INDEX_POLICY,
  assessProductIndexability,
  brandHubPath,
  effectiveDiscount,
  normalizeExternalUrl,
  parseObservedTimestamp,
};
