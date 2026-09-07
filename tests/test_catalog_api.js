import assert from 'node:assert/strict';
import test from 'node:test';

import catalogHandler, {
  PAGE_SIZE,
  dataRevision,
  decorateProduct,
  isVisibleProduct,
  parseCatalogRequest,
  queryCatalog,
  resetCatalogCache,
} from '../api/catalog.mjs';

const products = [
  {
    sku_id: 'arc-beta-us', brand: 'arcteryx', full_name: 'Beta Jacket Men',
    description: 'Waterproof shell', category: 'Jackets', sale_price: 300,
    discount_pct: 40, currency: 'USD', symbol: '$', gender: 'men', region: 'us',
    dealer: 'arcteryx_outlet', status: 'active', first_seen: '2026-08-31T01:00:00Z',
    last_updated: '2026-08-31T02:00:00Z', sizes: ['M'], size_stock: { M: 'in_stock' },
    url: 'https://outlet.arcteryx.com/us/en/shop/mens/beta-jacket',
  },
  {
    sku_id: 'burton-lalik-us', brand: 'burton', full_name: "Burton Lalik Jacket Women's",
    description: 'Insulated snow jacket', category: '其他', sale_price: 70,
    discount_pct: 65, currency: 'USD', symbol: '$', gender: 'women', region: 'us',
    dealer: 'evo', status: 'active', first_seen: '2026-08-30T01:00:00Z',
    last_updated: '2026-08-31T03:00:00Z', sizes: ['S'], size_stock: { S: 'in_stock' },
    url: 'https://www.evo.com/outlet/insulated-jackets/burton-lalik-jacket-womens',
  },
  {
    sku_id: 'patagonia-down-ca', brand: 'patagonia', full_name: 'Patagonia Down Sweater Men',
    description: 'Insulated jacket', category: '其他', sale_price: 180,
    discount_pct: 50, currency: 'CAD', symbol: 'C$', gender: 'men', region: 'ca',
    dealer: 'evo', status: 'active', first_seen: '2026-08-31T04:00:00Z',
    last_updated: '2026-08-31T04:00:00Z', sizes: ['L'], size_stock: { L: 'in_stock' },
    url: 'https://www.evo.com/outlet/down-jackets/patagonia-down-sweater-mens',
  },
  {
    sku_id: 'retired-ssense', brand: 'arcteryx', full_name: 'Beta Jacket',
    sale_price: 100, discount_pct: 10, currency: 'USD', gender: 'men', region: 'us',
    dealer: 'ssense', status: 'active', url: 'https://www.ssense.com/en-us/men/product/arcteryx/beta/1',
  },
].filter(isVisibleProduct).map(decorateProduct);

test('catalog data revision changes when public product content changes', () => {
  const before = [{
    sku_id: 'evo:swim',
    category: '其他',
    last_updated: '2026-09-07 08:05:58',
    status: 'active',
  }];
  const after = [{ ...before[0], category: '泳装' }];

  assert.notEqual(dataRevision(before), dataRevision(after));
});

test('catalog data revision is stable across record and object key order', () => {
  const left = [
    { sku_id: 'b', category: '固定器', size_stock: { M: 'in_stock', S: 'out_of_stock' } },
    { sku_id: 'a', category: '泳装', sizes: ['S', 'M'] },
  ];
  const right = [
    { sizes: ['S', 'M'], category: '泳装', sku_id: 'a' },
    { size_stock: { S: 'out_of_stock', M: 'in_stock' }, category: '固定器', sku_id: 'b' },
  ];

  assert.equal(dataRevision(left), dataRevision(right));
});

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

test('catalog query performs filtering, facets, sorting, and bounded pagination server-side', () => {
  const request = parseCatalogRequest(
    '/api/catalog?region=us&gender=women&sort=price_asc&page=1&limit=1&since=2026-08-31T00%3A00%3A00.000Z',
  );
  const result = queryCatalog(products, request, {
    codeRevision: 'code-1',
    dataRevision: 'data-1',
  });

  assert.equal(PAGE_SIZE, 60);
  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sku_id, 'burton-lalik-us');
  assert.equal(result.rows[0]._search, undefined);
  assert.equal(result.facets.gender.total, 2);
  assert.deepEqual(result.facets.gender.counts, { men: 1, women: 1 });
  assert.equal(result.facets.region.total, 1);
  assert.equal(result.catalog.total, 3);
  assert.equal(result.new_arrivals.count, 1);
  assert.equal(result.code_revision, 'code-1');
  assert.equal(result.data_revision, 'data-1');
});

test('catalog request validation fails closed', () => {
  assert.throws(() => parseCatalogRequest('/api/catalog?limit=61'), /Invalid limit/);
  assert.throws(() => parseCatalogRequest('/api/catalog?page=0'), /Invalid page/);
  assert.throws(() => parseCatalogRequest('/api/catalog?sort=unknown'), /Invalid sort/);
  assert.throws(() => parseCatalogRequest('/api/catalog?region=%3Cscript%3E'), /Invalid region/);
  assert.throws(() => parseCatalogRequest(`/api/catalog?q=${'x'.repeat(101)}`), /Invalid q/);
});

test('catalog endpoint returns a bounded JSON page and revision headers', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url.searchParams.get('limit'), '1000');
    assert.equal(url.searchParams.get('offset'), '0');
    return { ok: true, json: async () => products.map(({ _brand, _platform, _series, _category, ...row }) => row) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    resetCatalogCache();
  });
  resetCatalogCache();

  const req = {
    method: 'GET',
    url: '/api/catalog?region=us&limit=1',
    headers: {},
  };
  const res = responseRecorder();
  await catalogHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^application\/json/);
  assert.ok(res.headers['X-Code-Revision']);
  assert.match(res.headers['X-Data-Revision'], /^[a-f0-9]{20}$/);
  assert.match(res.headers['Cache-Control'], /max-age=30/);
  assert.equal(JSON.parse(res.body).rows.length, 1);
});

test('catalog endpoint rejects writes without loading data', async () => {
  const req = { method: 'POST', url: '/api/catalog', headers: {} };
  const res = responseRecorder();
  await catalogHandler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, HEAD');
  assert.deepEqual(JSON.parse(res.body), { error: 'method_not_allowed' });
});
