import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  parseProductPreviewCache,
  PRODUCT_PREVIEW_STORAGE_KEY,
  serializeProductPreview,
} from '../lib/productPreview';
import { findCheaperAlternatives } from '../lib/cheaperAlternatives';
import { computeSignal, groupHistoryBySku } from '../lib/signals';
import { fetchAllProducts, fetchInitialProducts, fetchPriceHistoryForSkus } from '../lib/supabase';
import type { DealSignal, Product } from '../lib/types';
import { usePreferences } from './PreferencesContext';

type ProductsContextValue = {
  products: Product[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadedCount: number;
  signals: Record<string, DealSignal>;
  reload: () => Promise<void>;
  ensureSignalsFor: (items: Product[]) => Promise<void>;
  getProduct: (skuId?: string | string[]) => Product | undefined;
  cheaperAlternatives: (product: Product) => Product[];
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

export function ProductsProvider({ children }: PropsWithChildren) {
  const { rateSnapshot } = usePreferences();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Record<string, DealSignal>>({});
  const requestedSignals = useRef(new Set<string>());
  const hasLoaded = useRef(false);

  const reload = useCallback(async () => {
    setError(null);
    setRefreshing(hasLoaded.current);
    setLoading(!hasLoaded.current);
    requestedSignals.current.clear();
    setSignals({});
    try {
      if (!hasLoaded.current) {
        try {
          const cachedPreview = parseProductPreviewCache(
            await AsyncStorage.getItem(PRODUCT_PREVIEW_STORAGE_KEY),
          );
          if (cachedPreview.length) setProducts(cachedPreview);
        } catch {
          // Cache failures must never block the live catalog.
        }

        try {
          const freshPreview = await fetchInitialProducts();
          if (freshPreview.length) {
            setProducts(freshPreview);
            void AsyncStorage
              .setItem(PRODUCT_PREVIEW_STORAGE_KEY, serializeProductPreview(freshPreview))
              .catch(() => undefined);
          }
        } catch {
          // Preview is an optimization; the authoritative full fetch still runs.
        }
      }

      const rows = await fetchAllProducts();
      setProducts(rows);
      hasLoaded.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const ensureSignalsFor = useCallback(async (items: Product[]) => {
    const pending = items
      .map((item) => item.sku_id)
      .filter((skuId) => skuId && !requestedSignals.current.has(skuId));

    if (!pending.length) return;
    pending.forEach((skuId) => requestedSignals.current.add(skuId));

    try {
      const rows = await fetchPriceHistoryForSkus(pending);
      const grouped = groupHistoryBySku(rows);
      const next: Record<string, DealSignal> = {};
      for (const product of items) {
        if (!pending.includes(product.sku_id)) continue;
        next[product.sku_id] = computeSignal(product, grouped.get(product.sku_id) || []);
      }
      setSignals((current) => ({ ...current, ...next }));
    } catch (err) {
      for (const skuId of pending) requestedSignals.current.delete(skuId);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const bySku = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(product.sku_id, product);
    return map;
  }, [products]);

  const getProduct = useCallback(
    (skuId?: string | string[]) => {
      const id = Array.isArray(skuId) ? skuId[0] : skuId;
      return id ? bySku.get(id) : undefined;
    },
    [bySku],
  );

  const cheaperAlternatives = useCallback(
    (product: Product) => findCheaperAlternatives(products, product, rateSnapshot),
    [products, rateSnapshot],
  );

  const value = useMemo(
    () => ({
      products,
      loading,
      refreshing,
      error,
      loadedCount: products.length,
      signals,
      reload,
      ensureSignalsFor,
      getProduct,
      cheaperAlternatives,
    }),
    [cheaperAlternatives, ensureSignalsFor, error, getProduct, loading, products, refreshing, reload, signals],
  );

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts() {
  const value = useContext(ProductsContext);
  if (!value) throw new Error('useProducts must be used inside ProductsProvider');
  return value;
}
