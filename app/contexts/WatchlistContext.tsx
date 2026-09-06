import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { usePro } from './ProContext';
import { softImpact } from '../lib/actions';
import { modelIdentity, type ModelWatchSource } from '../lib/modelWatch';
import type { CatalogProduct, Product, WatchEntry } from '../lib/types';
import {
  activeAlertCount,
  type AlertDraft,
  entryIdForModel,
  FREE_ALERT_LIMIT,
  FREE_WATCHLIST_LIMIT,
  parseStoredWatchEntries,
  saveEntryAlert,
  toggleScopedWatch,
  WATCHLIST_STORAGE_KEY,
} from '../lib/watchlist';

type WatchlistContextValue = {
  entries: WatchEntry[];
  hydrated: boolean;
  freeLimit: number;
  freeAlertLimit: number;
  activeAlertCount: number;
  isSaved: (skuId?: string | null) => boolean;
  getEntry: (skuId?: string | null) => WatchEntry | undefined;
  toggle: (product: Product) => Promise<boolean>;
  toggleModel: (source: Product | CatalogProduct) => Promise<boolean>;
  isModelSaved: (sourceOrKey: ModelWatchSource | string) => boolean;
  getModelEntry: (sourceOrKey: ModelWatchSource | string) => WatchEntry | undefined;
  saveAlert: (entryId: string, draft: AlertDraft) => Promise<boolean>;
  removeAlert: (entryId: string) => Promise<void>;
  setAlertTarget: (product: Product, target: number | null) => Promise<void>;
  remove: (skuId: string) => Promise<void>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: PropsWithChildren) {
  const { isPro } = usePro();
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const entriesRef = useRef<WatchEntry[]>([]);
  const mutationQueue = useRef(Promise.resolve());

  useEffect(() => {
    AsyncStorage.getItem(WATCHLIST_STORAGE_KEY)
      .then((raw) => {
        const next = parseStoredWatchEntries(raw);
        entriesRef.current = next;
        setEntries(next);
      })
      .catch(() => {
        entriesRef.current = [];
        setEntries([]);
      })
      .finally(() => setHydrated(true));
  }, []);

  const persist = useCallback(async (next: WatchEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
    await AsyncStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const mutate = useCallback(<T,>(operation: (current: WatchEntry[]) => Promise<{ entries: WatchEntry[]; value: T }>) => {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    mutationQueue.current = mutationQueue.current.then(async () => {
      const update = await operation(entriesRef.current);
      await persist(update.entries);
      resolveResult(update.value);
    }).catch((error) => rejectResult(error));
    return result;
  }, [persist]);

  const isSaved = useCallback((skuId?: string | null) => Boolean(skuId && entries.some((entry) => entry.skuId === skuId)), [entries]);
  const getEntry = useCallback((skuId?: string | null) => (skuId ? entries.find((entry) => entry.skuId === skuId) : undefined), [entries]);

  const toggle = useCallback(
    async (product: Product) => {
      await softImpact();
      return mutate(async (current) => {
        const result = toggleScopedWatch(current, product, 'sku', isPro);
        return { entries: result.entries, value: result.accepted };
      });
    },
    [isPro, mutate],
  );

  const toggleModel = useCallback(async (source: Product | CatalogProduct) => {
    await softImpact();
    return mutate(async (current) => {
      const result = toggleScopedWatch(current, source, 'model', isPro);
      return { entries: result.entries, value: result.accepted };
    });
  }, [isPro, mutate]);

  const modelEntryId = useCallback((sourceOrKey: ModelWatchSource | string) => (
    typeof sourceOrKey === 'string'
      ? entryIdForModel(sourceOrKey)
      : entryIdForModel(modelIdentity(sourceOrKey)?.key || '')
  ), []);
  const isModelSaved = useCallback((sourceOrKey: ModelWatchSource | string) => {
    const id = modelEntryId(sourceOrKey);
    return Boolean(id && entries.some((entry) => entry.id === id));
  }, [entries, modelEntryId]);
  const getModelEntry = useCallback((sourceOrKey: ModelWatchSource | string) => {
    const id = modelEntryId(sourceOrKey);
    return id ? entries.find((entry) => entry.id === id) : undefined;
  }, [entries, modelEntryId]);

  const saveAlert = useCallback((entryId: string, draft: AlertDraft) => mutate(async (current) => {
    const result = saveEntryAlert(current, entryId, draft, isPro);
    return { entries: result.entries, value: result.accepted };
  }), [isPro, mutate]);

  const removeAlert = useCallback((entryId: string) => mutate(async (current) => ({
    entries: current.map((entry) => entry.id === entryId
      ? { ...entry, alert: undefined, alertTarget: undefined }
      : entry),
    value: undefined,
  })), [mutate]);

  const setAlertTarget = useCallback(
    async (product: Product, target: number | null) => {
      await mutate(async (current) => {
        const entryId = `sku:${product.sku_id}`;
        let next = current;
        if (!next.some((entry) => entry.id === entryId)) {
          const watched = toggleScopedWatch(next, product, 'sku', isPro);
          if (!watched.accepted) throw new Error(watched.reason || 'watch-limit');
          next = watched.entries;
        }
        if (target === null) {
          return {
            entries: next.map((entry) => entry.id === entryId
              ? { ...entry, alert: undefined, alertTarget: undefined }
              : entry),
            value: undefined,
          };
        }
        const result = saveEntryAlert(next, entryId, {
          mode: 'custom', targetAmount: target, targetCurrency: product.currency,
          localEnabled: true,
        }, isPro);
        if (!result.accepted) throw new Error(result.reason || 'alert-limit');
        return { entries: result.entries, value: undefined };
      });
    },
    [isPro, mutate],
  );

  const remove = useCallback(async (skuId: string) => {
    await mutate(async (current) => ({ entries: current.filter((entry) => entry.skuId !== skuId && entry.id !== `sku:${skuId}`), value: undefined }));
  }, [mutate]);

  const value = useMemo(
    () => ({
      entries,
      hydrated,
      freeLimit: FREE_WATCHLIST_LIMIT,
      freeAlertLimit: FREE_ALERT_LIMIT,
      activeAlertCount: activeAlertCount(entries),
      isSaved,
      getEntry,
      toggle,
      toggleModel,
      isModelSaved,
      getModelEntry,
      saveAlert,
      removeAlert,
      setAlertTarget,
      remove,
    }),
    [entries, getEntry, getModelEntry, hydrated, isModelSaved, isSaved, remove, removeAlert, saveAlert, setAlertTarget, toggle, toggleModel],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist() {
  const value = useContext(WatchlistContext);
  if (!value) throw new Error('useWatchlist must be used inside WatchlistProvider');
  return value;
}
