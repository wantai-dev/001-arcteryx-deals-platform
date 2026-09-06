import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { fetchPriceCandidates, readCachedRateSnapshot } from './alertProductSource';
import { formatCurrencyValue } from './currency';
import { evaluatePriceAlerts, restoreFailedDeliveries } from './priceMonitor';
import { parseStoredWatchEntries, WATCHLIST_STORAGE_KEY } from './watchlist';
import { watchCopy } from './watchI18n';
import type { AppLanguage } from './i18n';

export const PRICE_MONITOR_TASK = 'geardrop-local-price-monitor-v1';

export async function runPriceMonitor(language: AppLanguage = 'en') {
  const raw = await AsyncStorage.getItem(WATCHLIST_STORAGE_KEY);
  const entries = parseStoredWatchEntries(raw);
  if (!entries.some((entry) => entry.alert?.localEnabled)) return { checked: 0, notified: 0 };
  const [candidates, rates] = await Promise.all([fetchPriceCandidates(entries), readCachedRateSnapshot()]);
  const evaluated = evaluatePriceAlerts(entries, candidates, rates);
  const failed = new Set<string>();
  const copy = watchCopy(language);
  for (const event of evaluated.events) {
    try {
      const price = formatCurrencyValue(event.price, event.currency, language, event.symbol);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: copy.alertTitle,
          body: copy.alertBody(event.name, price),
          data: { url: `/product/${event.skuId}`, skuId: event.skuId, watchEntryId: event.entryId },
        },
        trigger: null,
      });
    } catch {
      failed.add(event.entryId);
    }
  }
  const persisted = restoreFailedDeliveries(entries, evaluated.entries, failed);
  await AsyncStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(persisted));
  return { checked: candidates.length, notified: evaluated.events.length - failed.size };
}

if (!TaskManager.isTaskDefined(PRICE_MONITOR_TASK)) {
  TaskManager.defineTask(PRICE_MONITOR_TASK, async () => {
    try {
      await runPriceMonitor();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export function PriceMonitorRegistration() {
  const preferences = usePreferences();
  const runtimePreferences = preferences as typeof preferences & {
    hydrated?: boolean;
    notificationsEnabled?: boolean;
  };
  const enabled = runtimePreferences.notificationsEnabled !== false;
  const hydrated = runtimePreferences.hydrated !== false;

  useEffect(() => {
    if (!hydrated) return;
    async function updateRegistration() {
      const registered = await TaskManager.isTaskRegisteredAsync(PRICE_MONITOR_TASK);
      if (enabled && !registered) {
        const status = await BackgroundTask.getStatusAsync();
        if (status === BackgroundTask.BackgroundTaskStatus.Available) {
          await BackgroundTask.registerTaskAsync(PRICE_MONITOR_TASK, { minimumInterval: 60 });
        }
      } else if (!enabled && registered) {
        await BackgroundTask.unregisterTaskAsync(PRICE_MONITOR_TASK);
      }
    }
    void updateRegistration().catch(() => undefined);
  }, [enabled, hydrated]);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    void runPriceMonitor(preferences.language).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runPriceMonitor(preferences.language).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [enabled, hydrated, preferences.language]);

  return null;
}
