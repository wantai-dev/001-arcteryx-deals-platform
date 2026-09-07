import type { RateSnapshot } from './currency';
import type { Product } from './types';

function validPrice(value: number) {
  return Number.isFinite(value) && value > 0;
}

function comparablePrice(product: Product, referenceCurrency: string, snapshot: RateSnapshot | null) {
  if (!validPrice(product.sale_price)) return null;
  if (product.currency === referenceCurrency) return product.sale_price;

  const sourceRate = snapshot?.rates[product.currency];
  const referenceRate = snapshot?.rates[referenceCurrency];
  if (!Number.isFinite(sourceRate) || Number(sourceRate) <= 0 || !Number.isFinite(referenceRate) || Number(referenceRate) <= 0) {
    return null;
  }
  return (product.sale_price / Number(sourceRate)) * Number(referenceRate);
}

function isAlternativeCandidate(candidate: Product, product: Product) {
  return candidate._brand === product._brand
    && candidate.model === product.model
    && candidate.sku_id !== product.sku_id
    && candidate.region !== product.region
    && validPrice(candidate.sale_price);
}

export function hasUncomparableRegionalOffer(
  products: Product[], product: Product, snapshot: RateSnapshot | null,
) {
  return products.some((candidate) => isAlternativeCandidate(candidate, product)
    && comparablePrice(candidate, product.currency, snapshot) === null);
}

export function findCheaperAlternatives(
  products: Product[],
  product: Product,
  snapshot: RateSnapshot | null,
  limit = 4,
) {
  const referencePrice = comparablePrice(product, product.currency, snapshot);
  if (referencePrice === null || !Number.isInteger(limit) || limit <= 0) return [];

  const byRegion = new Map<string, { product: Product; price: number }>();
  for (const candidate of products) {
    if (!isAlternativeCandidate(candidate, product)) {
      continue;
    }

    const price = comparablePrice(candidate, product.currency, snapshot);
    if (price === null || price >= referencePrice) continue;

    const current = byRegion.get(candidate.region);
    if (!current || price < current.price || (price === current.price && candidate.sku_id.localeCompare(current.product.sku_id) < 0)) {
      byRegion.set(candidate.region, { product: candidate, price });
    }
  }

  return [...byRegion.values()]
    .sort((left, right) => left.price - right.price
      || left.product.region.localeCompare(right.product.region)
      || left.product.sku_id.localeCompare(right.product.sku_id))
    .slice(0, limit)
    .map(({ product: alternative }) => alternative);
}
