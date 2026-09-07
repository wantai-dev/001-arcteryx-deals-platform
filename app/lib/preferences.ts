import type { CurrencyPreference, RateSnapshot } from "./currency";
import type { LanguageChoice } from "./i18n";

export const PREFERENCES_V1_KEY = "geardrop.preferences.v1";
export const REGION_V1_KEY = "geardrop.region.v1";
export const PREFERENCES_V2_KEY = "geardrop.preferences.v2";
export type AppearancePreference = "system" | "light" | "dark";
export type PreferenceRateSource = "none" | "cached" | "live";
export type PreferenceRateStatus =
  | "original"
  | "loading"
  | "live"
  | "cached"
  | "unavailable";
export type AppPreferences = {
  language: LanguageChoice;
  currency: CurrencyPreference;
  region: string;
  appearance: AppearancePreference;
  notificationsEnabled: boolean;
};
export const DEFAULT_PREFERENCES: AppPreferences = {
  language: "system",
  currency: "original",
  region: "us",
  appearance: "system",
  notificationsEnabled: false,
};

const LANGUAGES = new Set(["system", "en", "zh-Hans", "de", "fr", "ja"]);
const CURRENCIES = new Set([
  "original",
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CNY",
]);
const APPEARANCES = new Set(["system", "light", "dark"]);
const REGIONS = new Set([
  "all",
  "us",
  "ca",
  "gb",
  "au",
  "de",
  "fr",
  "nl",
  "fi",
  "ie",
  "at",
  "be",
  "dk",
  "it",
  "es",
  "se",
  "ch",
]);

export const RATE_MAX_AGE_MS = 86400000;

export function rateSnapshotNeedsRefresh(
  snapshot: RateSnapshot | null,
  now = Date.now(),
) {
  if (!snapshot) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return !Number.isFinite(fetchedAt) || now - fetchedAt > RATE_MAX_AGE_MS;
}

export function preferenceRateStatus(
  currency: CurrencyPreference,
  snapshot: RateSnapshot | null,
  source: PreferenceRateSource,
  refreshing: boolean,
): PreferenceRateStatus {
  if (currency === "original") return "original";
  if (snapshot && source === "live") return "live";
  if (snapshot) return "cached";
  return refreshing ? "loading" : "unavailable";
}
function objectValue(raw: string | null) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function validObjectValue(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function normalizePreferences(
  value: Partial<AppPreferences>,
): AppPreferences {
  return {
    language: LANGUAGES.has(String(value.language))
      ? (value.language as LanguageChoice)
      : DEFAULT_PREFERENCES.language,
    currency: CURRENCIES.has(String(value.currency))
      ? (value.currency as CurrencyPreference)
      : DEFAULT_PREFERENCES.currency,
    region: REGIONS.has(String(value.region).toLowerCase())
      ? String(value.region).toLowerCase()
      : DEFAULT_PREFERENCES.region,
    appearance: APPEARANCES.has(String(value.appearance))
      ? (value.appearance as AppearancePreference)
      : DEFAULT_PREFERENCES.appearance,
    notificationsEnabled:
      typeof value.notificationsEnabled === "boolean"
        ? value.notificationsEnabled
        : DEFAULT_PREFERENCES.notificationsEnabled,
  };
}
export function migratePreferences(
  v2Raw: string | null,
  v1Raw: string | null,
  regionRaw: string | null,
) {
  const v2 = validObjectValue(v2Raw);
  if (v2) return normalizePreferences(v2);
  return normalizePreferences({
    ...objectValue(v1Raw),
    region: regionRaw || undefined,
  });
}

export type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createPreferenceStore(storage: PreferenceStorage) {
  let state = DEFAULT_PREFERENCES;
  let hydrated = false;
  let hydration: Promise<AppPreferences> | null = null;
  let writes = Promise.resolve();
  const listeners = new Set<(value: AppPreferences, ready: boolean) => void>();
  const publish = () => listeners.forEach((listener) => listener(state, hydrated));

  const hydrate = () => {
    if (hydrated) return Promise.resolve(state);
    if (hydration) return hydration;
    hydration = Promise.all([
      storage.getItem(PREFERENCES_V2_KEY),
      storage.getItem(PREFERENCES_V1_KEY),
      storage.getItem(REGION_V1_KEY),
    ])
      .then(async ([v2, v1, region]) => {
        const next = migratePreferences(v2, v1, region);
        await storage.setItem(PREFERENCES_V2_KEY, JSON.stringify(next));
        state = next;
        hydrated = true;
        publish();
        return state;
      })
      .finally(() => {
        hydration = null;
      });
    return hydration;
  };

  const update = (change: Partial<AppPreferences>) => {
    writes = writes.catch(() => undefined).then(async () => {
      await hydrate();
      const next = updatePreferences(state, change);
      await storage.setItem(PREFERENCES_V2_KEY, JSON.stringify(next));
      state = next;
      publish();
    });
    return writes;
  };

  return {
    hydrate,
    update,
    getSnapshot: () => ({ preferences: state, hydrated }),
    subscribe(listener: (value: AppPreferences, ready: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export function updatePreferences(
  current: AppPreferences,
  patch: Partial<AppPreferences>,
) {
  return normalizePreferences({ ...current, ...patch });
}
export function applyPreferencePatches(
  current: AppPreferences,
  patches: Partial<AppPreferences>[],
) {
  return patches.reduce(updatePreferences, current);
}
