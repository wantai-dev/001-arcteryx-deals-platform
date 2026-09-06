import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  convertAmount,
  CurrencyPreference,
  fetchRateSnapshot,
  formatCurrencyValue,
  RateSnapshot,
} from "../lib/currency";
import {
  AppLanguage,
  LanguageChoice,
  LANGUAGE_TAGS,
  localizedCategory,
  localizedGender,
  localizedRegion,
  resolveLanguage,
  translate,
  TranslationParams,
} from "../lib/i18n";
import {
  AppearancePreference,
  AppPreferences,
  applyPreferencePatches,
  DEFAULT_PREFERENCES,
  migratePreferences,
  PREFERENCES_V1_KEY,
  PREFERENCES_V2_KEY,
  REGION_V1_KEY,
  updatePreferences,
} from "../lib/preferences";

export const PREFERENCES_STORAGE_KEY = 'geardrop.preferences.v1';
export const RATES_STORAGE_KEY = "geardrop.currency-rates.v1";
const RATE_MAX_AGE_MS = 86400000;
type RateStatus = "original" | "loading" | "live" | "cached" | "unavailable";
type Value = {
  languageChoice: LanguageChoice;
  language: AppLanguage;
  locale: string;
  currency: CurrencyPreference;
  region: string;
  appearance: AppearancePreference;
  notificationsEnabled: boolean;
  hydrated: boolean;
  rateStatus: RateStatus;
  rateDate: string | null;
  rateSnapshot: RateSnapshot | null;
  setLanguage: (v: LanguageChoice) => Promise<void>;
  setCurrency: (v: CurrencyPreference) => Promise<void>;
  setMarket: (v: {
    region: string;
    currency: CurrencyPreference;
  }) => Promise<void>;
  setAppearance: (v: AppearancePreference) => Promise<void>;
  setNotificationsEnabled: (v: boolean) => Promise<void>;
  refreshRates: () => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
  categoryLabel: (v: string) => string;
  genderLabel: (v: string) => string;
  regionLabel: (v: string) => string;
  formatMoney: (v: number, c: string, s?: string) => string;
  formatOriginalMoney: (v: number, c: string, s?: string) => string;
  convertValue: (v: number, c: string) => number;
  displayedCurrency: (c: string) => string;
  formatNumber: (v: number, digits?: number) => string;
};
const Context = createContext<Value | null>(null);
function parseSnapshot(raw: string | null) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as RateSnapshot;
    return v?.date && v?.fetchedAt && v?.rates?.EUR === 1 ? v : null;
  } catch {
    return null;
  }
}

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [preferences, setState] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const ref = useRef(preferences);
  const pending = useRef<Partial<AppPreferences>[]>([]);
  const queue = useRef(Promise.resolve());
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<RateSnapshot | null>(null);
  const [rateStatus, setRateStatus] = useState<RateStatus>("original");
  const persist = useCallback((next: AppPreferences) => {
    queue.current = queue.current
      .catch(() => undefined)
      .then(() =>
        AsyncStorage.setItem(PREFERENCES_V2_KEY, JSON.stringify(next)),
      );
    return queue.current;
  }, []);
  const patch = useCallback(
    (change: Partial<AppPreferences>) => {
      if (!hydratedRef.current) pending.current.push(change);
      const next = updatePreferences(ref.current, change);
      ref.current = next;
      setState(next);
      return hydratedRef.current ? persist(next) : Promise.resolve();
    },
    [persist],
  );
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(PREFERENCES_V2_KEY),
      AsyncStorage.getItem(PREFERENCES_V1_KEY),
      AsyncStorage.getItem(REGION_V1_KEY),
      AsyncStorage.getItem(RATES_STORAGE_KEY),
    ])
      .then(([v2, v1, region, rates]) => {
        const next = applyPreferencePatches(
          migratePreferences(v2, v1, region),
          pending.current,
        );
        pending.current = [];
        ref.current = next;
        hydratedRef.current = true;
        setState(next);
        setSnapshot(parseSnapshot(rates));
        setHydrated(true);
        return persist(next);
      })
      .catch(() => {
        hydratedRef.current = true;
        setHydrated(true);
        return persist(ref.current);
      });
  }, [persist]);
  const refreshRates = useCallback(async () => {
    setRateStatus((current) =>
      preferences.currency === "original"
        ? "original"
        : snapshot
          ? current
          : "loading",
    );
    try {
      const next = await fetchRateSnapshot();
      setSnapshot(next);
      setRateStatus(preferences.currency === "original" ? "original" : "live");
      await AsyncStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setRateStatus(
        preferences.currency === "original"
          ? "original"
          : snapshot
            ? "cached"
            : "unavailable",
      );
    }
  }, [preferences.currency, snapshot]);
  useEffect(() => {
    if (preferences.currency === "original") setRateStatus("original");
    const fetchedAt = snapshot ? Date.parse(snapshot.fetchedAt) : 0;
    if (
      hydrated &&
      (!snapshot ||
        !Number.isFinite(fetchedAt) ||
        Date.now() - fetchedAt > RATE_MAX_AGE_MS)
    )
      void refreshRates();
  }, [hydrated, preferences.currency, refreshRates, snapshot]);
  const setLanguage = useCallback(
    (language: LanguageChoice) => patch({ language }),
    [patch],
  );
  const setCurrency = useCallback(
    (currency: CurrencyPreference) => patch({ currency }),
    [patch],
  );
  const setMarket = useCallback(
    (market: { region: string; currency: CurrencyPreference }) => patch(market),
    [patch],
  );
  const setAppearance = useCallback(
    (appearance: AppearancePreference) => patch({ appearance }),
    [patch],
  );
  const setNotificationsEnabled = useCallback(
    (notificationsEnabled: boolean) => patch({ notificationsEnabled }),
    [patch],
  );
  const language = resolveLanguage(
    preferences.language,
    getLocales()[0]?.languageCode,
  );
  const locale = LANGUAGE_TAGS[language];
  const t = useCallback(
    (key: string, params?: TranslationParams) =>
      translate(language, key, params),
    [language],
  );
  const categoryLabel = useCallback(
    (v: string) => localizedCategory(language, v),
    [language],
  );
  const genderLabel = useCallback(
    (v: string) => localizedGender(language, v),
    [language],
  );
  const regionLabel = useCallback(
    (v: string) =>
      v === "all" ? t("deals.allRegions") : localizedRegion(language, v),
    [language, t],
  );
  const formatOriginalMoney = useCallback(
    (v: number, c: string, s = "") => formatCurrencyValue(v, c, locale, s),
    [locale],
  );
  const formatMoney = useCallback(
    (v: number, c: string, s = "") => {
      const x = convertAmount(v, c, preferences.currency, snapshot);
      return formatCurrencyValue(
        x.value,
        x.currency,
        locale,
        x.converted ? "" : s,
      );
    },
    [locale, preferences.currency, snapshot],
  );
  const convertValue = useCallback(
    (v: number, c: string) =>
      convertAmount(v, c, preferences.currency, snapshot).value,
    [preferences.currency, snapshot],
  );
  const displayedCurrency = useCallback(
    (c: string) => convertAmount(1, c, preferences.currency, snapshot).currency,
    [preferences.currency, snapshot],
  );
  const formatNumber = useCallback(
    (v: number, digits = 0) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
        v,
      ),
    [locale],
  );
  const value = useMemo<Value>(
    () => ({
      ...preferences,
      hydrated,
      languageChoice: preferences.language,
      language,
      locale,
      rateStatus,
      rateDate: snapshot?.date || null,
      rateSnapshot: snapshot,
      setLanguage,
      setCurrency,
      setMarket,
      setAppearance,
      setNotificationsEnabled,
      refreshRates,
      t,
      categoryLabel,
      genderLabel,
      regionLabel,
      formatMoney,
      formatOriginalMoney,
      convertValue,
      displayedCurrency,
      formatNumber,
    }),
    [
      preferences,
      hydrated,
      language,
      locale,
      rateStatus,
      snapshot,
      setLanguage,
      setCurrency,
      setMarket,
      setAppearance,
      setNotificationsEnabled,
      refreshRates,
      t,
      categoryLabel,
      genderLabel,
      regionLabel,
      formatMoney,
      formatOriginalMoney,
      convertValue,
      displayedCurrency,
      formatNumber,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value)
    throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
