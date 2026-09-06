import type { CurrencyPreference } from "./currency";
import type { LanguageChoice } from "./i18n";

export const PREFERENCES_V1_KEY = "geardrop.preferences.v1";
export const REGION_V1_KEY = "geardrop.region.v1";
export const PREFERENCES_V2_KEY = "geardrop.preferences.v2";
export type AppearancePreference = "system" | "light" | "dark";
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
  if (v2Raw) return normalizePreferences(objectValue(v2Raw));
  return normalizePreferences({
    ...objectValue(v1Raw),
    region: regionRaw || undefined,
  });
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
