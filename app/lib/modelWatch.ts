import type { CatalogProduct, Product } from './types';

export type ModelWatchSource = Product | CatalogProduct;

export type ModelIdentity = {
  key: string;
  brand: Product['brand'];
  officialProductId?: string;
  normalizedName: string;
  gender: string;
  category: string;
  stable: boolean;
};

function isCatalogProduct(source: ModelWatchSource): source is CatalogProduct {
  return 'catalog_product_id' in source;
}

export function normalizeModelText(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function modelIdentity(source: ModelWatchSource): ModelIdentity | null {
  const catalog = isCatalogProduct(source);
  const brand = catalog ? source.brand_key : source.brand;
  const officialProductId = String(source.official_product_id || '').trim().toLowerCase();
  const normalizedName = normalizeModelText(catalog ? source.name : source.model || source.full_name);
  const gender = normalizeModelText(source.gender);
  const category = normalizeModelText(catalog ? source.categories[0] : source.category);
  if (officialProductId) {
    return {
      key: `${brand}:official:${officialProductId}`,
      brand,
      officialProductId,
      normalizedName,
      gender,
      category,
      stable: true,
    };
  }
  if (!normalizedName || !gender || gender === 'unknown' || !category) return null;
  return {
    key: `${brand}:fallback:${normalizedName}:${gender}:${category}`,
    brand,
    normalizedName,
    gender,
    category,
    stable: true,
  };
}

export function modelKeyForProduct(product: Product): string | null {
  return modelIdentity(product)?.key || null;
}

export function modelKeyForCatalogProduct(product: CatalogProduct): string {
  const identity = modelIdentity(product);
  if (!identity) throw new Error(`Catalog product ${product.catalog_product_id} has no stable model identity.`);
  return identity.key;
}

export function sameModel(left: ModelWatchSource, right: ModelWatchSource): boolean {
  const leftIdentity = modelIdentity(left);
  const rightIdentity = modelIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity.key === rightIdentity.key);
}
