import { modelKeyForCatalogProduct, modelKeyForProduct } from './modelWatch';
import type { CatalogProduct, Product, WatchEntry } from './types';
import { indexYearbookDeals } from './yearbook';

/** Rebuild model membership from the current authoritative catalog and deal rows. */
export function resolveCurrentModelSkus(
  entries: WatchEntry[], catalog: CatalogProduct[], deals: Product[],
): Map<string, string> {
  const modelEntries = entries.filter((entry) => entry.scope === 'model' && entry.modelKey);
  if (!modelEntries.length) return new Map();
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
  return new Map([...claims].flatMap(([skuId, keys]) => keys.size === 1 ? [[skuId, [...keys][0]!] as const] : []));
}
