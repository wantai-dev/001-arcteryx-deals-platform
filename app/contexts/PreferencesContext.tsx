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
  createPreferenceStore,
  DEFAULT_PREFERENCES,
  PreferenceRateStatus,
  PreferenceRateSource,
  PREFERENCES_V2_KEY,
  preferenceRateStatus,
  rateSnapshotNeedsRefresh,
} from "../lib/preferences";

export const PREFERENCES_STORAGE_KEY = PREFERENCES_V2_KEY;
export const LEGACY_PREFERENCES_STORAGE_KEY = "geardrop.preferences.v1";
export const RATES_STORAGE_KEY = "geardrop.currency-rates.v1";
type Value = {
  languageChoice: LanguageChoice;
  language: AppLanguage;
  locale: string;
  currency: CurrencyPreference;
  region: string;
  appearance: AppearancePreference;
  notificationsEnabled: boolean;
  hydrated: boolean;
  rateStatus: PreferenceRateStatus;
  rateDate: string | null;
  rateSnapshot: RateSnapshot | null;
  preferencesError: boolean;
  setLanguage: (v: LanguageChoice) => Promise<void>;
  setCurrency: (v: CurrencyPreference) => Promise<void>;
  setMarket: (v: {
    region: string;
    currency: CurrencyPreference;
  }) => Promise<void>;
  setAppearance: (v: AppearancePreference) => Promise<void>;
  setNotificationsEnabled: (v: boolean) => Promise<void>;
  refreshRates: () => Promise<void>;
  retryPreferences: () => Promise<void>;
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
  const store = useRef(createPreferenceStore(AsyncStorage));
  const [hydrated, setHydrated] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [snapshot, setSnapshot] = useState<RateSnapshot | null>(null);
  const [rateSource, setRateSource] = useState<PreferenceRateSource>("none");
  const [ratesHydrated, setRatesHydrated] = useState(false);
  const [rateRefreshing, setRateRefreshing] = useState(false);
  const rateRefreshInFlight = useRef<Promise<void> | null>(null);
  const automaticRateAttempt = useRef<string | null>(null);
  const patch = useCallback(
    (change: Partial<AppPreferences>) => store.current.update(change),
    [],
  );
  const retryPreferences = useCallback(async () => {
    setPreferencesError(false);
    try {
      await store.current.hydrate();
    } catch {
      setPreferencesError(true);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = store.current.subscribe((next, ready) => {
      setState(next);
      setHydrated(ready);
      if (ready) setPreferencesError(false);
    });
    void retryPreferences();
    void (async () => {
      try {
        const cached = parseSnapshot(await AsyncStorage.getItem(RATES_STORAGE_KEY));
        if (!cancelled) {
          setSnapshot(cached);
          setRateSource(cached ? "cached" : "none");
        }
      } catch {
        if (!cancelled) {
          setSnapshot(null);
          setRateSource("none");
        }
      } finally {
        if (!cancelled) setRatesHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [retryPreferences]);
  const refreshRates = useCallback(() => {
    if (rateRefreshInFlight.current) return rateRefreshInFlight.current;
    setRateRefreshing(true);
    const request = (async () => {
      try {
        const next = await fetchRateSnapshot();
        setSnapshot(next);
        setRateSource("live");
        try {
          await AsyncStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Keep the usable in-memory snapshot if the offline cache cannot be updated.
        }
      } catch {
        // The derived status preserves a cached snapshot or reports unavailable.
      } finally {
        setRateRefreshing(false);
        rateRefreshInFlight.current = null;
      }
    })();
    rateRefreshInFlight.current = request;
    return request;
  }, []);
  useEffect(() => {
    if (!hydrated || !ratesHydrated || !rateSnapshotNeedsRefresh(snapshot))
      return;
    const attemptKey = snapshot?.fetchedAt || "missing";
    if (automaticRateAttempt.current === attemptKey) return;
    automaticRateAttempt.current = attemptKey;
    void refreshRates();
  }, [hydrated, ratesHydrated, refreshRates, snapshot]);
  const rateStatus =
    !ratesHydrated && preferences.currency !== "original"
      ? "loading"
      : preferenceRateStatus(
          preferences.currency,
          snapshot,
          rateSource,
          rateRefreshing,
        );
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
      preferencesError,
      setLanguage,
      setCurrency,
      setMarket,
      setAppearance,
      setNotificationsEnabled,
      refreshRates,
      retryPreferences,
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
      preferencesError,
      setLanguage,
      setCurrency,
      setMarket,
      setAppearance,
      setNotificationsEnabled,
      refreshRates,
      retryPreferences,
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
