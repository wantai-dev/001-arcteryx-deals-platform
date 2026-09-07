'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sampleProduct = {
  sku_id: 'evo:products/218050-burton-lalik-jacket-women-s',
  brand: 'burton',
  model: 'Lalik Jacket',
  full_name: "Burton Lalik Jacket Women's",
  category: 'Jackets',
  color: 'True Black',
  original_price: 199.95,
  sale_price: 69.99,
  discount_pct: 65,
  currency: 'USD',
  symbol: '$',
  gender: 'women',
  image_url: '//images.example.com/lalik.jpg',
  region: 'us',
  url: 'https://www.evo.com/outlet/insulated-jackets/burton-lalik-jacket-womens',
  dealer: 'evo',
  last_updated: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  url_http_status: 200,
  status: 'active',
  sizes: ['S', 'M'],
  size_stock: { S: 'in_stock', M: 'out_of_stock' },
};

function parseJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(match, 'JSON-LD script should be present');
  return JSON.parse(match[1]);
}

function schemaTypes(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) schemaTypes(item, found);
  } else if (value && typeof value === 'object') {
    const type = value['@type'];
    if (Array.isArray(type)) type.forEach((item) => found.add(item));
    else if (type) found.add(type);
    Object.values(value).forEach((item) => schemaTypes(item, found));
  }
  return found;
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

let productEndpoint;

test.before(async () => {
  const module = await import('../api/product.mjs');
  productEndpoint = Object.assign(module.default, {
    canonicalProductUrl: module.canonicalProductUrl,
    fetchProduct: module.fetchProduct,
    renderProductPage: module.renderProductPage,
  });
});

test('server product page exposes specific canonical Product and Offer facts', () => {
  const html = productEndpoint.renderProductPage(sampleProduct);
  const canonical = 'https://geardrop.100app.dev/p?sku=evo%3Aproducts%2F218050-burton-lalik-jacket-women-s';

  assert.match(html, /<h1>Burton Lalik Jacket Women&#39;s<\/h1>/);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
  assert.ok(html.includes('$69.99 USD'));
  assert.ok(html.includes('最终价格、库存、配送、税费和退货条件以销售平台为准'));
  assert.ok(html.includes('不是库存或结算价保证'));
  assert.ok(html.includes('product-detail.html?sku=evo%3Aproducts%2F218050-burton-lalik-jacket-women-s'));
  assert.ok(html.includes('href="/brands/burton.html"'));
  assert.ok(html.includes('src="https://images.example.com/lalik.jpg"'));
  assert.ok(html.includes('content="index,follow,max-image-preview:large,max-snippet:-1"'));
  assert.ok(!html.includes('aggregateRating'));
  assert.ok(!html.includes('reviewCount'));

  assert.deepEqual(
    [...schemaTypes(parseJsonLd(html))].sort(),
    ['Brand', 'BreadcrumbList', 'ListItem', 'Offer', 'Organization', 'Product', 'PropertyValue', 'WebPage', 'WebSite'].sort(),
  );
});

test('server product endpoint returns cacheable HTML for an active SKU', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url.searchParams.get('sku_id'), `eq.${sampleProduct.sku_id}`);
    assert.equal(url.searchParams.get('status'), 'eq.active');
    assert.equal(url.searchParams.get('dealer'), 'neq.ssense');
    assert.equal(options.headers.Accept, 'application/json');
    return { ok: true, json: async () => [sampleProduct] };
  };
  t.after(() => { global.fetch = originalFetch; });

  const req = {
    method: 'GET',
    query: { sku: sampleProduct.sku_id },
    url: `/p?sku=${encodeURIComponent(sampleProduct.sku_id)}`,
  };
  const res = responseRecorder();
  await productEndpoint(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  assert.match(res.headers['Cache-Control'], /s-maxage=900/);
  assert.equal(res.headers['X-Robots-Tag'], undefined);
  assert.match(res.body, /<h1>Burton Lalik Jacket Women&#39;s<\/h1>/);
});

test('server product page keeps lower-confidence deals accessible but noindex', () => {
  const html = productEndpoint.renderProductPage(
    { ...sampleProduct, discount_pct: 20, original_price: 100, sale_price: 80 },
    { evaluatedAt: new Date() },
  );
  assert.ok(html.includes('content="noindex,follow"'));
});

test('server product endpoint emits an X-Robots-Tag for a lower-confidence deal', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => [{
      ...sampleProduct,
      discount_pct: 20,
      original_price: 100,
      sale_price: 80,
    }],
  });
  t.after(() => { global.fetch = originalFetch; });

  const req = {
    method: 'GET',
    query: { sku: sampleProduct.sku_id },
    url: `/p?sku=${encodeURIComponent(sampleProduct.sku_id)}`,
  };
  const res = responseRecorder();
  await productEndpoint(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, follow');
  assert.match(res.body, /content="noindex,follow"/);
});

test('server product endpoint fails closed for missing and invalid requests', async () => {
  const missing = responseRecorder();
  await productEndpoint({ method: 'GET', query: {}, url: '/p' }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers['X-Robots-Tag'], 'noindex, follow');
  assert.match(missing.body, /未找到商品/);

  const malformed = responseRecorder();
  await productEndpoint(
    { method: 'GET', query: { sku: `invalid-${'x'.repeat(129)}` }, url: '/p' },
    malformed,
  );
  assert.equal(malformed.statusCode, 404);
  assert.equal(malformed.headers['X-Robots-Tag'], 'noindex, follow');

  const invalidMethod = responseRecorder();
  await productEndpoint({ method: 'POST', query: {}, url: '/p' }, invalidMethod);
  assert.equal(invalidMethod.statusCode, 405);
  assert.equal(invalidMethod.headers.Allow, 'GET, HEAD');
  assert.equal(invalidMethod.headers['Cache-Control'], 'no-store');
});
