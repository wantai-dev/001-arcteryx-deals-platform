import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessProductIndexability,
  brandHubPath,
  normalizeExternalUrl,
} from './seo-index.mjs';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

const SITE_URL = 'https://geardrop.100app.dev';
const PRODUCT_FIELDS = [
  'sku_id', 'brand', 'model', 'full_name', 'category', 'color',
  'original_price', 'sale_price', 'discount_pct', 'currency', 'symbol',
  'gender', 'image_url', 'region', 'url', 'dealer', 'last_updated',
  'last_seen_at', 'url_http_status', 'status', 'sizes', 'size_stock',
].join(',');

const BRAND_LABELS = {
  arcteryx: "Arc'teryx",
  burton: 'Burton',
  patagonia: 'Patagonia',
};

const PLATFORM_LABELS = {
  arcteryx_outlet: "Arc'teryx Outlet",
  backcountry: 'Backcountry',
  burton: 'Burton',
  evo: 'EVO',
  mec: 'MEC',
  rei: 'REI',
  ssense: 'SSENSE',
};

const REGION_LABELS = {
  at: '奥地利', au: '澳大利亚', be: '比利时', ca: '加拿大', ch: '瑞士',
  de: '德国', dk: '丹麦', es: '西班牙', fi: '芬兰', fr: '法国', gb: '英国',
  ie: '爱尔兰', it: '意大利', jp: '日本', nl: '荷兰', se: '瑞典', us: '美国',
};
const VALID_SKU = /^[A-Za-z0-9._:/-]{1,128}$/;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value) {
  return normalizeExternalUrl(value);
}

function parseMaybeJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function productName(product) {
  return String(product.full_name || product.model || '户外装备').trim();
}

function canonicalProductUrl(sku) {
  return `${SITE_URL}/p?sku=${encodeURIComponent(sku)}`;
}

function interactiveProductUrl(sku) {
  return `${SITE_URL}/product-detail.html?sku=${encodeURIComponent(sku)}`;
}

function publicSupabaseConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return [process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY];
  }
  const template = fs.readFileSync(path.join(API_DIR, '..', 'product-detail.html'), 'utf8');
  const url = template.match(/^const SUPABASE_URL\s*=\s*'([^']+)';/m)?.[1];
  const key = template.match(/^const SUPABASE_ANON\s*=\s*'([^']+)';/m)?.[1];
  if (!url || !key) throw new Error('Public catalog configuration is unavailable');
  return [url, key];
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchProduct(sku, fetchImpl = fetch) {
  const [supabaseUrl, anonKey] = publicSupabaseConfig();
  const url = new URL('/rest/v1/products', supabaseUrl);
  url.searchParams.set('select', PRODUCT_FIELDS);
  url.searchParams.set('sku_id', `eq.${sku}`);
  url.searchParams.set('status', 'eq.active');
  url.searchParams.set('dealer', 'neq.ssense');
  url.searchParams.set('limit', '1');

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) throw new Error(`Catalog returned HTTP ${response.status}`);
        throw new Error(`Catalog temporarily returned HTTP ${response.status}`);
      }
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Catalog response was not an array');
      return rows[0] || null;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(150 * (2 ** attempt));
    }
  }
  throw lastError || new Error('Catalog request failed');
}

function availability(product) {
  const stock = parseMaybeJson(product.size_stock, {});
  const values = Object.values(stock || {});
  if (values.some((value) => value === 'in_stock')) return 'https://schema.org/InStock';
  if (values.length && values.every((value) => value === 'out_of_stock')) {
    return 'https://schema.org/OutOfStock';
  }
  return null;
}

function renderProductPage(product, options = {}) {
  const sku = String(product.sku_id);
  const name = productName(product);
  const brandKey = String(product.brand || '').toLowerCase();
  const brand = BRAND_LABELS[brandKey] || product.brand || '未标记品牌';
  const platform = PLATFORM_LABELS[String(product.dealer || '').toLowerCase()]
    || product.dealer || '销售平台';
  const region = REGION_LABELS[String(product.region || '').toLowerCase()]
    || product.region || '对应地区';
  const canonical = canonicalProductUrl(sku);
  const interactive = interactiveProductUrl(sku);
  const brandHub = brandHubPath(brandKey);
  const retailer = safeUrl(product.url);
  const image = safeUrl(product.image_url);
  const indexability = options.indexability
    || assessProductIndexability(product, options.evaluatedAt || new Date());
  const robots = indexability.eligible
    ? 'index,follow,max-image-preview:large,max-snippet:-1'
    : 'noindex,follow';
  const price = Number(product.sale_price);
  const originalPrice = Number(product.original_price);
  const currency = String(product.currency || '').toUpperCase();
  const validOffer = Number.isFinite(price) && price > 0 && /^[A-Z]{3}$/.test(currency) && retailer;
  const description = `${name}：GearDrop 最近记录的 ${platform} ${region}商品事实、价格与更新时间。最终价格、库存、配送、税费和退货条件以销售平台为准。`;
  const modified = /^\d{4}-\d{2}-\d{2}/.test(String(product.last_updated || ''))
    ? String(product.last_updated).slice(0, 10) : undefined;

  const productNode = {
    '@type': 'Product',
    '@id': `${canonical}#product`,
    name,
    description,
    sku,
    image: image || undefined,
    brand: { '@type': 'Brand', name: brand },
    category: product.category || undefined,
    color: product.color || undefined,
    mainEntityOfPage: { '@id': `${canonical}#webpage` },
    additionalProperty: [
      { '@type': 'PropertyValue', name: '销售平台', value: platform },
      { '@type': 'PropertyValue', name: '销售地区', value: region },
      { '@type': 'PropertyValue', name: '最近观察时间', value: product.last_updated || '未提供' },
    ],
  };
  if (validOffer) {
    productNode.offers = {
      '@type': 'Offer',
      url: retailer,
      price,
      priceCurrency: currency,
      seller: { '@type': 'Organization', name: platform },
      availability: availability(product) || undefined,
    };
  }

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: 'GearDrop',
        alternateName: 'GearDrop Outdoor Deals',
        url: `${SITE_URL}/`,
        publishingPrinciples: `${SITE_URL}/methodology.html`,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: 'GearDrop',
        publisher: { '@id': `${SITE_URL}/#organization` },
        inLanguage: 'zh-CN',
      },
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: `${name} 折扣与价格`,
        description,
        inLanguage: 'zh-CN',
        isPartOf: { '@id': `${SITE_URL}/#website` },
        publisher: { '@id': `${SITE_URL}/#organization` },
        mainEntity: { '@id': `${canonical}#product` },
        breadcrumb: { '@id': `${canonical}#breadcrumb` },
        dateModified: modified,
      },
      productNode,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'GearDrop', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: brand, item: `${SITE_URL}${brandHub}` },
          { '@type': 'ListItem', position: 3, name, item: canonical },
        ],
      },
    ],
  };
  const schemaText = JSON.stringify(schema).replaceAll('<', '\\u003c');
  const priceText = validOffer
    ? `${escapeHtml(product.symbol || '')}${escapeHtml(price.toFixed(2))} ${escapeHtml(currency)}`
    : '价格待回到销售平台确认';
  const originalText = Number.isFinite(originalPrice) && originalPrice > price
    ? `<span class="old-price">原价 ${escapeHtml(product.symbol || '')}${escapeHtml(originalPrice.toFixed(2))}</span>` : '';
  const retailerAction = retailer
    ? `<a class="button primary" href="${escapeHtml(retailer)}" rel="nofollow sponsored noopener" target="_blank">前往 ${escapeHtml(platform)} 核验与购买 ↗</a>` : '';
  const imageMarkup = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" width="720" height="900">`
    : '<div class="image-placeholder">暂无商品图</div>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} 折扣与价格 · GearDrop</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="GearDrop">
  <meta property="og:title" content="${escapeHtml(name)} · GearDrop">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image || `${SITE_URL}/assets/brand/geardrop-og.png`)}">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png">
  <link rel="manifest" href="/site.webmanifest">
  <script type="application/ld+json">${schemaText}</script>
  <style>
    :root{--ink:#171918;--muted:#6e736f;--green:#17372f;--line:#dddcd6;--paper:#f7f6f1;--red:#b64237;font-family:Inter,"Noto Sans SC",system-ui,sans-serif;color:var(--ink);background:var(--paper)}*{box-sizing:border-box}body{margin:0}.top{border-bottom:1px solid var(--line);background:#fff}.top-inner,.shell{width:min(1120px,calc(100% - 32px));margin:auto}.top-inner{min-height:68px;display:flex;align-items:center;justify-content:space-between}.logo{width:142px;height:auto}.back{color:var(--green)}.shell{padding:38px 0 64px}.breadcrumb{font-size:13px;color:var(--muted);margin-bottom:24px}.breadcrumb a{color:var(--green)}.product{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.8fr);gap:54px}.media{background:#eeece6;border-radius:22px;overflow:hidden;min-height:480px;display:grid;place-items:center}.media img{width:100%;height:auto;display:block}.image-placeholder{color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--muted)}h1{font-size:clamp(34px,5vw,58px);line-height:1.04;margin:12px 0 22px}.price{font-size:30px;font-weight:800;color:var(--red)}.old-price{display:block;font-size:14px;font-weight:400;color:var(--muted);margin-top:5px}.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:28px 0}.facts div{border-top:1px solid var(--line);padding-top:10px}.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:3px 0;overflow-wrap:anywhere}.actions{display:grid;gap:10px;margin:28px 0}.button{display:block;text-align:center;padding:14px 18px;border-radius:10px;border:1px solid var(--green);color:var(--green);text-decoration:none;font-weight:750}.button.primary{background:var(--green);color:#fff}.boundary{border-left:4px solid #d07360;background:#fff0ea;padding:15px 17px;border-radius:0 10px 10px 0}.knowledge{margin-top:46px;border-top:1px solid var(--line);padding-top:24px;display:flex;gap:20px;flex-wrap:wrap}.knowledge a{color:var(--green)}.top-inner a,.breadcrumb a,.knowledge a{display:inline-flex;align-items:center;min-height:44px}.breadcrumb a{padding:0 4px}.knowledge a{padding:0 6px}@media(max-width:760px){.product{grid-template-columns:1fr;gap:28px}.media{min-height:280px}.facts{grid-template-columns:1fr}.shell{padding-top:24px}}
  </style>
</head>
<body>
  <header class="top"><div class="top-inner"><a href="/" aria-label="GearDrop 首页"><img class="logo" src="/assets/brand/geardrop-logo.png" alt="GearDrop" width="355" height="76"></a><a class="back" href="/">返回折扣目录</a></div></header>
  <main class="shell">
    <nav class="breadcrumb" aria-label="面包屑"><a href="/">GearDrop</a> / <a href="${escapeHtml(brandHub)}">${escapeHtml(brand)}</a> / ${escapeHtml(name)}</nav>
    <article class="product">
      <div class="media">${imageMarkup}</div>
      <div>
        <div class="eyebrow">${escapeHtml(brand)} · ${escapeHtml(platform)} · ${escapeHtml(region)}</div>
        <h1>${escapeHtml(name)}</h1>
        <div class="price">${priceText}${originalText}</div>
        <dl class="facts">
          <div><dt>销售平台</dt><dd>${escapeHtml(platform)}</dd></div>
          <div><dt>地区 / 币种</dt><dd>${escapeHtml(region)} / ${escapeHtml(currency || '未提供')}</dd></div>
          <div><dt>品类</dt><dd>${escapeHtml(product.category || '未标记')}</dd></div>
          <div><dt>最近观察</dt><dd>${escapeHtml(product.last_updated || '未提供')}</dd></div>
          <div><dt>颜色</dt><dd>${escapeHtml(product.color || '未提供')}</dd></div>
          <div><dt>SKU</dt><dd>${escapeHtml(sku)}</dd></div>
        </dl>
        <div class="actions">${retailerAction}<a class="button" href="${escapeHtml(interactive)}">查看颜色、尺码、价格历史与提醒</a></div>
        <p class="boundary">GearDrop 是独立折扣追踪服务，不销售商品。这里是最近一次目录观察，不是库存或结算价保证；购买前请在销售平台复核价格、库存、配送、税费与退货条件。</p>
      </div>
    </article>
    <nav class="knowledge" aria-label="相关说明"><a href="/methodology.html">数据方法与限制</a><a href="/catalog-status.html">当前目录状态</a><a href="/faq.html">常见问题</a></nav>
  </main>
</body>
</html>`;
}

function renderErrorPage(status) {
  const missing = status === 404;
  const title = missing ? '未找到商品' : '商品信息暂时不可用';
  const body = missing
    ? '该 SKU 不存在、已下架或不在当前活跃目录中。'
    : 'GearDrop 暂时无法读取当前目录，请稍后重试。';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · GearDrop</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="${SITE_URL}/"></head><body><main><h1>${title}</h1><p>${body}</p><p><a href="/">返回 GearDrop 折扣目录</a></p></main></body></html>`;
}

function sendHtml(req, res, status, html, cacheControl, robots = '') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (status !== 200 || robots) res.setHeader('X-Robots-Tag', robots || 'noindex, follow');
  res.end(req.method === 'HEAD' ? '' : html);
}

async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return sendHtml(req, res, 405, renderErrorPage(405), 'no-store');
  }
  const querySku = Array.isArray(req.query?.sku) ? req.query.sku[0] : req.query?.sku;
  const fallbackSku = new URL(req.url || '/', 'https://local.invalid').searchParams.get('sku');
  const sku = String(querySku || fallbackSku || '').trim();
  if (!VALID_SKU.test(sku)) {
    return sendHtml(req, res, 404, renderErrorPage(404), 'public, max-age=60');
  }
  try {
    const product = await fetchProduct(sku);
    if (!product) return sendHtml(req, res, 404, renderErrorPage(404), 'public, max-age=300');
    const indexability = assessProductIndexability(product, new Date());
    return sendHtml(
      req,
      res,
      200,
      renderProductPage(product, { indexability }),
      'public, max-age=0, s-maxage=900, stale-while-revalidate=86400',
      indexability.eligible ? '' : 'noindex, follow',
    );
  } catch (_) {
    return sendHtml(req, res, 503, renderErrorPage(503), 'no-store');
  }
}

export { canonicalProductUrl, fetchProduct, publicSupabaseConfig, renderProductPage };
export default handler;
