import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import { getLocales } from 'expo-localization';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { hasNotificationPermission } from './actions';
import { fetchPriceCandidates, readCachedRateSnapshot } from './alertProductSource';
import { formatCurrencyValue } from './currency';
import { conditionallyRestoreFailedDeliveries, evaluatePriceAlerts } from './priceMonitor';
import { watchlistStore } from './watchlistRuntimeStore';
import { watchCopy } from './watchI18n';
import type { AppLanguage } from './i18n';
import { migratePreferences, PREFERENCES_V1_KEY, PREFERENCES_V2_KEY, REGION_V1_KEY } from './preferences';
import { resolveLanguage } from './i18n';
import { createQueuedSingleFlight } from './queuedSingleFlight';

export const PRICE_MONITOR_TASK = 'geardrop-local-price-monitor-v1';
type MonitorOutcome = { checked: number; notified: number; skipped?: 'web' | 'disabled' | 'permission' };

async function runtimePreferences() {
  try {
    const [v2Raw, v1Raw, regionRaw] = await Promise.all([
      AsyncStorage.getItem(PREFERENCES_V2_KEY),
      AsyncStorage.getItem(PREFERENCES_V1_KEY),
      AsyncStorage.getItem(REGION_V1_KEY),
    ]);
    const value = migratePreferences(v2Raw, v1Raw, regionRaw);
    return {
      enabled: value.notificationsEnabled,
      language: resolveLanguage(value.language, getLocales()[0]?.languageCode),
    };
  } catch {
    return { enabled: false, language: 'en' as AppLanguage };
  }
}

async function executePriceMonitor(languageOverride?: AppLanguage): Promise<MonitorOutcome> {
  if (Platform.OS === 'web') return { checked: 0, notified: 0, skipped: 'web' };
  const prefs = await runtimePreferences();
  if (!prefs.enabled) return { checked: 0, notified: 0, skipped: 'disabled' };
  const permission = await Notifications.getPermissionsAsync();
  if (!hasNotificationPermission(permission)) return { checked: 0, notified: 0, skipped: 'permission' };
  await watchlistStore.hydrate();
  const initial = watchlistStore.snapshot().entries;
  if (!initial.some((entry) => entry.alert?.localEnabled)) return { checked: 0, notified: 0 };
  const [candidates, rates] = await Promise.all([fetchPriceCandidates(initial), readCachedRateSnapshot()]);
  const evaluated = await watchlistStore.mutate(async (current) => {
    const latestPrefs = await runtimePreferences();
    if (!latestPrefs.enabled) return { entries: current, value: null };
    const result = evaluatePriceAlerts(current, candidates, rates);
    return { entries: result.entries, value: result };
  });
  if (!evaluated) return { checked: candidates.length, notified: 0, skipped: 'disabled' };
  const failed = new Set<string>();
  const copy = watchCopy(languageOverride || prefs.language);
  for (const event of evaluated.events) {
    try {
      const price = formatCurrencyValue(event.price, event.currency, languageOverride || prefs.language, event.symbol);
      await Notifications.scheduleNotificationAsync({
        content: { title: copy.alertTitle, body: copy.alertBody(event.name, price), data: { url: `/product/${event.skuId}`, skuId: event.skuId, watchEntryId: event.entryId } },
        trigger: null,
      });
    } catch { failed.add(event.entryId); }
  }
  if (failed.size) {
    await watchlistStore.mutate((current) => ({
      entries: conditionallyRestoreFailedDeliveries(current, evaluated.events, failed), value: undefined,
    })).catch(() => undefined);
  }
  return { checked: candidates.length, notified: evaluated.events.length - failed.size };
}

const queuedMonitor = createQueuedSingleFlight((language?: AppLanguage) => executePriceMonitor(language));

export function runPriceMonitor(language?: AppLanguage) { return queuedMonitor(language); }

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(PRICE_MONITOR_TASK)) {
  TaskManager.defineTask(PRICE_MONITOR_TASK, async () => {
    try { await runPriceMonitor(); return BackgroundTask.BackgroundTaskResult.Success; }
    catch { return BackgroundTask.BackgroundTaskResult.Failed; }
  });
}

export function PriceMonitorRegistration() {
  const preferences = usePreferences();
  const runtime = preferences as typeof preferences & { hydrated?: boolean; notificationsEnabled?: boolean };
  const enabled = Platform.OS !== 'web' && runtime.notificationsEnabled !== false;
  const hydrated = runtime.hydrated !== false;
  useEffect(() => {
    if (!hydrated || Platform.OS === 'web') return;
    void (async () => {
      const registered = await TaskManager.isTaskRegisteredAsync(PRICE_MONITOR_TASK);
      if (enabled && !registered && await BackgroundTask.getStatusAsync() === BackgroundTask.BackgroundTaskStatus.Available) {
        await BackgroundTask.registerTaskAsync(PRICE_MONITOR_TASK, { minimumInterval: 60 });
      } else if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(PRICE_MONITOR_TASK);
    })().catch(() => undefined);
  }, [enabled, hydrated]);
  useEffect(() => {
    if (!enabled || !hydrated) return;
    void runPriceMonitor(preferences.language).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void runPriceMonitor(preferences.language).catch(() => undefined); });
    return () => subscription.remove();
  }, [enabled, hydrated, preferences.language]);
  return null;
}
