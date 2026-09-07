import { modelIdentity, modelKeyForCatalogProduct, modelKeyForProduct } from './modelWatch';
import type { CatalogProduct, Product, WatchEntry } from './types';
import { indexYearbookDeals } from './yearbook';

export type CurrentModelSkuResolution = {
  modelBySku: Map<string, string>;
  catalogRejectedSkuIds: Set<string>;
};

/** Rebuild model membership from the current authoritative catalog and deal rows. */
export function resolveCurrentModelSkus(
  entries: WatchEntry[], catalog: CatalogProduct[], deals: Product[],
): CurrentModelSkuResolution {
  const modelEntries = entries.filter((entry) => entry.scope === 'model' && entry.modelKey);
  if (!modelEntries.length) return { modelBySku: new Map(), catalogRejectedSkuIds: new Set() };
  const dealIndex = indexYearbookDeals(catalog, deals);
  const catalogsByModelKey = new Map<string, CatalogProduct[]>();
  for (const item of catalog) {
    const key = modelKeyForCatalogProduct(item);
    const values = catalogsByModelKey.get(key) || [];
    values.push(item);
    catalogsByModelKey.set(key, values);
  }

  const claims = new Map<string, Set<string>>();
  for (const entry of modelEntries) {
    let targets = entry.snapshot?.catalogProductId
      ? catalog.filter((item) => item.catalog_product_id === entry.snapshot?.catalogProductId)
      : catalogsByModelKey.get(entry.modelKey!) || [];
    // Legacy fallback entries can be recovered only when their current deal identity
    // points to exactly one catalog style through the conservative Yearbook index.
    if (!targets.length && entry.modelKey?.includes(':fallback:')) {
      targets = catalog.filter((item) => (dealIndex.byCatalogId[item.catalog_product_id] || [])
        .some((deal) => modelKeyForProduct(deal) === entry.modelKey));
    }
    if (targets.length !== 1) continue;
    for (const deal of dealIndex.byCatalogId[targets[0]!.catalog_product_id] || []) {
      const values = claims.get(deal.sku_id) || new Set<string>();
      values.add(entry.modelKey!);
      claims.set(deal.sku_id, values);
    }
  }
  const modelBySku = new Map([...claims].flatMap(([skuId, keys]) => keys.size === 1 ? [[skuId, [...keys][0]!] as const] : []));
  const watchedFallbackKeys = new Set(modelEntries
    .map((entry) => entry.modelKey!)
    .filter((key) => key.includes(':fallback:')));
  const catalogIdentities = catalog.map((item) => modelIdentity(item)).filter(Boolean);
  const catalogRejectedSkuIds = new Set(dealIndex.unmatched
    .filter((deal) => {
      const key = modelKeyForProduct(deal);
      const identity = modelIdentity(deal);
      if (!key || !identity || !watchedFallbackKeys.has(key)) return false;
      return catalogIdentities.some((catalogIdentity) => catalogIdentity
        && catalogIdentity.brand === identity.brand
        && catalogIdentity.normalizedName === identity.normalizedName
        && catalogIdentity.gender === identity.gender);
    })
    .map((deal) => deal.sku_id));
  return { modelBySku, catalogRejectedSkuIds };
}
