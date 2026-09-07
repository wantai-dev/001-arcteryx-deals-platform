import { productName } from './catalog';
import { modelKeyForProduct } from './modelWatch';
import type { CurrentModelSkuResolution } from './modelCandidateResolver';
import type { PriceCandidate } from './priceMonitor';
import type { Product } from './types';

export function productsToPriceCandidates(
  products: Product[], resolution: CurrentModelSkuResolution = {
    modelBySku: new Map<string, string>(),
    catalogRejectedSkuIds: new Set<string>(),
  },
): PriceCandidate[] {
  return products.map((product) => ({
    skuId: product.sku_id,
    modelKey: resolution.catalogRejectedSkuIds.has(product.sku_id)
      ? null
      : resolution.modelBySku.get(product.sku_id) || modelKeyForProduct(product),
    name: productName(product),
    price: product.sale_price,
    currency: product.currency,
    symbol: product.symbol,
    updatedAt: product.last_updated || product.last_seen_at || '',
  }));
}
