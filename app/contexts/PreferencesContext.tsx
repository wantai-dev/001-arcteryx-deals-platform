import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { convertAmount, CurrencyPreference, fetchRateSnapshot, formatCurrencyValue, RateSnapshot } from '../lib/currency';
import { AppLanguage, LanguageChoice, LANGUAGE_TAGS, localizedCategory, localizedGender, localizedRegion, resolveLanguage, translate, TranslationParams } from '../lib/i18n';

export const PREFERENCES_STORAGE_KEY = 'geardrop.preferences.v1';
export const RATES_STORAGE_KEY = 'geardrop.currency-rates.v1';
const RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type StoredPreferences = {
  language: LanguageChoice;
  currency: CurrencyPreference;
};

type RateStatus = 'original' | 'loading' | 'live' | 'cached' | 'unavailable';

type PreferencesContextValue = {
  languageChoice: LanguageChoice;
  language: AppLanguage;
  locale: string;
  currency: CurrencyPreference;
  rateStatus: RateStatus;
  rateDate: string | null;
  rateSnapshot: RateSnapshot | null;
  setLanguage: (choice: LanguageChoice) => Promise<void>;
  setCurrency: (currency: CurrencyPreference) => Promise<void>;
  refreshRates: () => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
  categoryLabel: (category: string) => string;
  genderLabel: (gender: string) => string;
  regionLabel: (region: string) => string;
  formatMoney: (value: number, sourceCurrency: string, fallbackSymbol?: string) => string;
  formatOriginalMoney: (value: number, sourceCurrency: string, fallbackSymbol?: string) => string;
  convertValue: (value: number, sourceCurrency: string) => number;
  displayedCurrency: (sourceCurrency: string) => string;
  formatNumber: (value: number, maximumFractionDigits?: number) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function parsePreferences(raw: string | null): StoredPreferences {
  if (!raw) return { language: 'system', currency: 'original' };
  try {
    const value = JSON.parse(raw) as Partial<StoredPreferences>;
    const language = ['system', 'en', 'zh-Hans', 'de', 'fr', 'ja'].includes(String(value.language)) ? (value.language as LanguageChoice) : 'system';
    const currency = ['original', 'USD', 'CAD', 'EUR', 'GBP', 'JPY', 'CHF'].includes(String(value.currency)) ? (value.currency as CurrencyPreference) : 'original';
    return { language, currency };
  } catch {
    return { language: 'system', currency: 'original' };
  }
}

function parseSnapshot(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RateSnapshot;
    return value?.date && value?.fetchedAt && value?.rates?.EUR === 1 ? value : null;
  } catch {
    return null;
  }
}

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<StoredPreferences>({ language: 'system', currency: 'original' });
  const [snapshot, setSnapshot] = useState<RateSnapshot | null>(null);
  const [rateStatus, setRateStatus] = useState<RateStatus>('original');

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(PREFERENCES_STORAGE_KEY), AsyncStorage.getItem(RATES_STORAGE_KEY)])
      .then(([storedPreferences, storedRates]) => {
        const nextPreferences = parsePreferences(storedPreferences);
        const cached = parseSnapshot(storedRates);
        setPreferences(nextPreferences);
        setSnapshot(cached);
        setRateStatus(nextPreferences.currency === 'original' ? 'original' : cached ? 'cached' : 'loading');
      })
      .catch(() => {
        setPreferences({ language: 'system', currency: 'original' });
        setRateStatus('original');
      });
  }, []);

  const refreshRates = useCallback(async () => {
    setRateStatus((current) => (preferences.currency === 'original' ? 'original' : snapshot ? current : 'loading'));
    try {
      const next = await fetchRateSnapshot();
      setSnapshot(next);
      setRateStatus(preferences.currency === 'original' ? 'original' : 'live');
      await AsyncStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setRateStatus(preferences.currency === 'original' ? 'original' : snapshot ? 'cached' : 'unavailable');
    }
  }, [preferences.currency, snapshot]);

  useEffect(() => {
    if (preferences.currency === 'original') setRateStatus('original');
    const fetchedAt = snapshot ? Date.parse(snapshot.fetchedAt) : 0;
    if (!snapshot || !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > RATE_MAX_AGE_MS) void refreshRates();
  }, [preferences.currency, refreshRates, snapshot]);

  const setLanguage = useCallback(async (language: LanguageChoice) => {
    const next = { ...preferences, language };
    setPreferences(next);
    await AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  }, [preferences]);

  const setCurrency = useCallback(async (currency: CurrencyPreference) => {
    const next = { ...preferences, currency };
    setPreferences(next);
    setRateStatus(currency === 'original' ? 'original' : snapshot ? 'cached' : 'loading');
    await AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  }, [preferences, snapshot]);

  const deviceLanguage = getLocales()[0]?.languageCode;
  const language = resolveLanguage(preferences.language, deviceLanguage);
  const locale = LANGUAGE_TAGS[language];
  const t = useCallback((key: string, params?: TranslationParams) => translate(language, key, params), [language]);
  const categoryLabel = useCallback((category: string) => localizedCategory(language, category), [language]);
  const genderLabel = useCallback((gender: string) => localizedGender(language, gender), [language]);
  const regionLabel = useCallback((region: string) => {
    if (region === 'all') return t('deals.allRegions');
    return localizedRegion(language, region);
  }, [language, t]);
  const formatOriginalMoney = useCallback((value: number, sourceCurrency: string, fallbackSymbol = '') => formatCurrencyValue(value, sourceCurrency, locale, fallbackSymbol), [locale]);
  const formatMoney = useCallback((value: number, sourceCurrency: string, fallbackSymbol = '') => {
    const converted = convertAmount(value, sourceCurrency, preferences.currency, snapshot);
    return formatCurrencyValue(converted.value, converted.currency, locale, converted.converted ? '' : fallbackSymbol);
  }, [locale, preferences.currency, snapshot]);
  const convertValue = useCallback((value: number, sourceCurrency: string) => convertAmount(value, sourceCurrency, preferences.currency, snapshot).value, [preferences.currency, snapshot]);
  const displayedCurrency = useCallback((sourceCurrency: string) => convertAmount(1, sourceCurrency, preferences.currency, snapshot).currency, [preferences.currency, snapshot]);
  const formatNumber = useCallback((value: number, maximumFractionDigits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value), [locale]);

  const value = useMemo<PreferencesContextValue>(() => ({
    languageChoice: preferences.language,
    language,
    locale,
    currency: preferences.currency,
    rateStatus,
    rateDate: snapshot?.date || null,
    rateSnapshot: snapshot,
    setLanguage,
    setCurrency,
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
  }), [categoryLabel, convertValue, displayedCurrency, formatMoney, formatNumber, formatOriginalMoney, genderLabel, language, locale, preferences.currency, preferences.language, rateStatus, refreshRates, regionLabel, setCurrency, setLanguage, snapshot, t]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}
