import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationRoute } from '../lib/notificationRoute';

test('notification taps keep exact SKU identifiers in route params including merchant slashes', () => {
  const skuId = 'evo:products/123-model';
  assert.deepEqual(notificationRoute({ skuId, url: `/product/${skuId}` }), { pathname: '/product/[skuId]', params: { skuId } });
  assert.equal(notificationRoute({ url: '/watchlist' }), '/watchlist');
});

test('unknown URLs and invalid notification data never become arbitrary navigation', () => {
  assert.equal(notificationRoute({ url: 'https://example.com' }), null);
  assert.equal(notificationRoute({ skuId: '\ninvalid' }), null);
  assert.equal(notificationRoute({ skuId: '' }), null);
  assert.equal(notificationRoute(undefined), null);
});
