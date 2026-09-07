import { modelIdentity, type ModelWatchSource } from './modelWatch';
import type { AlertMode, CatalogProduct, LocalPriceAlert, Product, WatchEntry, WatchProductSnapshot } from './types';

export const WATCHLIST_STORAGE_KEY = 'geardrop.watchlist.v1';
export const FREE_WATCHLIST_LIMIT = 20;
export const FREE_ALERT_LIMIT = 1;

type WatchProduct = Pick<Product, 'sku_id' | 'sale_price' | 'symbol'>;

export type AlertDraft = {
  mode: AlertMode;
  targetAmount: number;
  targetCurrency: string;
  localEnabled: boolean;
  email?: string;
};

export type WatchMutation = {
  accepted: boolean;
  entries: WatchEntry[];
  reason?: 'watch-limit' | 'alert-limit' | 'unstable-model';
};

export function parseWatchEntries(raw: string | null) {
  if (!raw) return [] as WatchEntry[];
  try {
    const entries = JSON.parse(raw) as WatchEntry[];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function makeWatchEntry(product: WatchProduct, nowIso = new Date().toISOString()): WatchEntry {
  return {
    skuId: product.sku_id,
    savedAt: nowIso,
    savedPrice: product.sale_price,
    symbol: product.symbol,
  };
}

export function toggleWatchEntry(entries: WatchEntry[], product: WatchProduct, isPro: boolean, nowIso = new Date().toISOString()) {
  if (entries.some((entry) => entry.skuId === product.sku_id)) {
    return {
      accepted: true,
      entries: entries.filter((entry) => entry.skuId !== product.sku_id),
    };
  }

  if (!isPro && entries.length >= FREE_WATCHLIST_LIMIT) {
    return {
      accepted: false,
      entries,
    };
  }

  return {
    accepted: true,
    entries: [makeWatchEntry(product, nowIso), ...entries],
  };
}

export function setWatchAlertTarget(entries: WatchEntry[], product: WatchProduct, target: number | null, nowIso = new Date().toISOString()) {
  const existing = entries.find((entry) => entry.skuId === product.sku_id);
  const nextEntry: WatchEntry = existing ? { ...existing } : makeWatchEntry(product, nowIso);
  nextEntry.alertTarget = target ?? undefined;
  return [nextEntry, ...entries.filter((entry) => entry.skuId !== product.sku_id)];
}

function isCatalogProduct(source: ModelWatchSource): source is CatalogProduct {
  return 'catalog_product_id' in source;
}

export function watchSnapshot(source: ModelWatchSource): WatchProductSnapshot {
  const catalog = isCatalogProduct(source);
  return {
    skuId: catalog ? undefined : source.sku_id,
    brand: catalog ? source.brand_key : source.brand,
    name: catalog ? source.name : source.model || source.full_name || source.sku_id,
    model: catalog ? source.name : source.model || undefined,
    gender: source.gender || undefined,
    category: catalog ? source.categories[0] : source.category || undefined,
    officialProductId: source.official_product_id || undefined,
    catalogProductId: catalog ? source.catalog_product_id : undefined,
    currency: source.currency,
    symbol: catalog ? source.currency : source.symbol,
    price: catalog ? source.list_price : source.sale_price,
    imageUrl: catalog ? undefined : source.image_url || undefined,
    sourceUrl: catalog ? source.source_url : source.url || undefined,
  };
}

export function entryIdForSku(skuId: string) {
  return `sku:${skuId}`;
}

export function entryIdForModel(sourceOrKey: ModelWatchSource | string): string | null {
  const key = typeof sourceOrKey === 'string' ? sourceOrKey : modelIdentity(sourceOrKey)?.key;
  return key ? `model:${key}` : null;
}

export function normalizeWatchEntry(entry: WatchEntry): WatchEntry | null {
  if (!entry || !entry.savedAt || !Number.isFinite(Date.parse(entry.savedAt))
    || !Number.isFinite(entry.savedPrice) || entry.savedPrice <= 0) return null;
  if (!entry.skuId && !(entry.scope === 'model' && entry.modelKey)) return null;
  const id = entry.id || (entry.scope === 'model' && entry.modelKey ? `model:${entry.modelKey}` : entryIdForSku(entry.skuId));
  const scope = entry.scope === 'model' && entry.modelKey ? 'model' : 'sku';
  const targetCurrency = entry.alert?.targetCurrency || entry.savedMoney?.currency || entry.snapshot?.currency;
  const legacyAlert = entry.alertTarget && targetCurrency
    ? makeLocalAlert({ mode: 'custom', targetAmount: entry.alertTarget, targetCurrency, localEnabled: true })
    : undefined;
  let alert = entry.alert || legacyAlert;
  if (alert && (
    !['percent10', 'historicalLow', 'custom'].includes(alert.mode)
    || !Number.isFinite(alert.targetAmount) || alert.targetAmount <= 0
    || !/^[A-Z]{3}$/.test(alert.targetCurrency)
    || typeof alert.localEnabled !== 'boolean'
    || typeof alert.armed !== 'boolean'
    || !Number.isFinite(alert.rearmAbove) || alert.rearmAbove <= alert.targetAmount
    || (alert.email !== undefined && typeof alert.email !== 'string')
  )) alert = undefined;
  const snapshot = entry.snapshot ? {
    ...entry.snapshot,
    resolvedSkuIds: Array.isArray(entry.snapshot.resolvedSkuIds)
      ? [...new Set(entry.snapshot.resolvedSkuIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))]
        .slice(0, 200)
      : undefined,
  } : undefined;
  return {
    ...entry,
    id,
    scope,
    snapshot,
    savedMoney: entry.savedMoney || (snapshot?.currency ? { amount: entry.savedPrice, currency: snapshot.currency } : undefined),
    alert,
  };
}

export function parseStoredWatchEntries(raw: string | null): WatchEntry[] {
  const seen = new Set<string>();
  return parseWatchEntries(raw)
    .map(normalizeWatchEntry)
    .filter((entry): entry is WatchEntry => {
      if (!entry?.id || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

export function makeScopedWatchEntry(
  source: ModelWatchSource,
  scope: 'sku' | 'model',
  nowIso = new Date().toISOString(),
  resolvedOffers: Product[] = [],
): WatchEntry | null {
  const snapshot = watchSnapshot(source);
  if (scope === 'model') {
    const identity = modelIdentity(source);
    if (!identity) return null;
    const resolvedSkuIds = [...new Set(resolvedOffers.map((offer) => offer.sku_id).filter(Boolean))].slice(0, 200);
    const representativeOffer = resolvedOffers[0];
    return {
      id: `model:${identity.key}`,
      scope,
      modelKey: identity.key,
      skuId: '',
      savedAt: nowIso,
      savedPrice: snapshot.price,
      symbol: snapshot.symbol,
      savedMoney: { amount: snapshot.price, currency: snapshot.currency },
      snapshot: {
        ...snapshot,
        skuId: snapshot.skuId || representativeOffer?.sku_id,
        imageUrl: snapshot.imageUrl || representativeOffer?.image_url || undefined,
        resolvedSkuIds,
      },
    };
  }
  if (!snapshot.skuId) return null;
  return {
    id: entryIdForSku(snapshot.skuId),
    scope,
    skuId: snapshot.skuId,
    savedAt: nowIso,
    savedPrice: snapshot.price,
    symbol: snapshot.symbol,
    savedMoney: { amount: snapshot.price, currency: snapshot.currency },
    snapshot,
  };
}

export function toggleScopedWatch(
  entries: WatchEntry[], source: ModelWatchSource, scope: 'sku' | 'model', isPro: boolean,
  nowIso = new Date().toISOString(),
  resolvedOffers: Product[] = [],
): WatchMutation {
  const candidate = makeScopedWatchEntry(source, scope, nowIso, resolvedOffers);
  if (!candidate?.id) return { accepted: false, entries, reason: 'unstable-model' };
  if (entries.some((entry) => entry.id === candidate.id)) {
    return { accepted: true, entries: entries.filter((entry) => entry.id !== candidate.id) };
  }
  if (!isPro && entries.length >= FREE_WATCHLIST_LIMIT) {
    return { accepted: false, entries, reason: 'watch-limit' };
  }
  return { accepted: true, entries: [candidate, ...entries] };
}

export function makeLocalAlert(draft: AlertDraft): LocalPriceAlert {
  if (!Number.isFinite(draft.targetAmount) || draft.targetAmount <= 0 || !draft.targetCurrency.trim()) {
    throw new Error('Alert target and currency are required.');
  }
  const email = draft.email?.trim().toLowerCase();
  return {
    mode: draft.mode,
    targetAmount: draft.targetAmount,
    targetCurrency: draft.targetCurrency.toUpperCase(),
    localEnabled: draft.localEnabled,
    ...(email ? { email } : {}),
    armed: true,
    rearmAbove: draft.targetAmount * 1.02,
  };
}

export function activeAlertCount(entries: WatchEntry[]) {
  return entries.filter((entry) => entry.alert?.localEnabled || entry.alert?.email).length;
}

export function saveEntryAlert(
  entries: WatchEntry[], entryId: string, draft: AlertDraft, isPro: boolean,
): WatchMutation {
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { accepted: false, entries, reason: 'unstable-model' };
  const existingActive = Boolean(entries[index]?.alert?.localEnabled || entries[index]?.alert?.email);
  const nextActive = Boolean(draft.localEnabled || draft.email?.trim());
  if (!isPro && nextActive && !existingActive && activeAlertCount(entries) >= FREE_ALERT_LIMIT) {
    return { accepted: false, entries, reason: 'alert-limit' };
  }
  const next = [...entries];
  next[index] = { ...next[index]!, alertTarget: draft.targetAmount, alert: makeLocalAlert(draft) };
  return { accepted: true, entries: next };
}

export function clearMatchingUnconfirmedEmail(
  entries: WatchEntry[], entryId: string, draft: AlertDraft,
) {
  const normalizedEmail = draft.email?.trim().toLowerCase();
  return entries.map((entry) => {
    const alert = entry.id === entryId ? entry.alert : undefined;
    if (!alert || !normalizedEmail
      || alert.mode !== draft.mode
      || alert.targetAmount !== draft.targetAmount
      || alert.targetCurrency !== draft.targetCurrency.toUpperCase()
      || alert.localEnabled !== draft.localEnabled
      || alert.email !== normalizedEmail) return entry;
    return { ...entry, alert: { ...alert, email: undefined } };
  });
}

export function saveSourceAlert(
  entries: WatchEntry[], source: ModelWatchSource, scope: 'sku' | 'model', draft: AlertDraft,
  isPro: boolean, resolvedOffers: Product[] = [], nowIso = new Date().toISOString(),
): WatchMutation {
  const id = scope === 'model'
    ? entryIdForModel(source)
    : (!isCatalogProduct(source) ? entryIdForSku(source.sku_id) : null);
  if (!id) return { accepted: false, entries, reason: 'unstable-model' };
  let next = entries;
  let created = false;
  if (!next.some((entry) => entry.id === id)) {
    const candidate = makeScopedWatchEntry(source, scope, nowIso, resolvedOffers);
    if (!candidate) return { accepted: false, entries, reason: 'unstable-model' };
    if (!isPro && next.length >= FREE_WATCHLIST_LIMIT) return { accepted: false, entries, reason: 'watch-limit' };
    next = [candidate, ...next];
    created = true;
  }
  const result = saveEntryAlert(next, id, draft, isPro);
  return !result.accepted && created ? { ...result, entries } : result;
}
