import { productName } from './catalog';
import { modelKeyForProduct } from './modelWatch';
import type { PriceCandidate } from './priceMonitor';
import type { Product } from './types';

export function productsToPriceCandidates(
  products: Product[], resolvedModelBySku = new Map<string, string>(),
): PriceCandidate[] {
  return products.map((product) => ({
    skuId: product.sku_id,
    modelKey: resolvedModelBySku.get(product.sku_id) || modelKeyForProduct(product),
    name: productName(product),
    price: product.sale_price,
    currency: product.currency,
    symbol: product.symbol,
    updatedAt: product.last_updated || product.last_seen_at || '',
  }));
}
