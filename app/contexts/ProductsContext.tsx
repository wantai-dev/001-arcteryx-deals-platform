import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  parseProductPreviewCache,
  PRODUCT_PREVIEW_STORAGE_KEY,
  serializeProductPreview,
} from '../lib/productPreview';
import { findCheaperAlternatives } from '../lib/cheaperAlternatives';
import { SignalLoader } from '../lib/signalLoader';
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
  const signalLoader = useRef<SignalLoader | null>(null);
  if (!signalLoader.current) signalLoader.current = new SignalLoader(fetchPriceHistoryForSkus, (next) => setSignals((current) => ({ ...current, ...next })));
  const reloadPending = useRef<Promise<void> | null>(null);
  const hasLoaded = useRef(false);

  const reload = useCallback(() => {
    if (reloadPending.current) return reloadPending.current;
    const run = async () => {
      setError(null);
      setRefreshing(hasLoaded.current);
      setLoading(!hasLoaded.current);
      signalLoader.current!.reset();
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
    };
    const pending = run();
    reloadPending.current = pending;
    void pending.finally(() => { if (reloadPending.current === pending) reloadPending.current = null; });
    return pending;
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const ensureSignalsFor = useCallback(async (items: Product[]) => {
    try {
      await signalLoader.current!.ensure(items);
    } catch (err) {
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
