import type { CurrencyPreference } from "./currency";

export type MarketRegionOption = {
  value: string;
  label: string;
  currency: string;
};

export type MarketCurrencyOption = {
  value: CurrencyPreference;
  label: string;
};

export const REGION_LOCAL_CURRENCY: Readonly<Record<string, string>> = {
  us: "USD",
  ca: "CAD",
  gb: "GBP",
  au: "AUD",
  de: "EUR",
  fr: "EUR",
  nl: "EUR",
  fi: "EUR",
  ie: "EUR",
  it: "EUR",
  es: "EUR",
  at: "EUR",
  be: "EUR",
  ch: "CHF",
  se: "SEK",
  dk: "DKK",
  jp: "JPY",
};

const PRIMARY_MARKET_CURRENCIES = [
  "original",
  "CNY",
  "USD",
  "EUR",
] as const satisfies readonly CurrencyPreference[];

export function marketRegionOptions(
  regions: readonly string[],
  regionLabel: (region: string) => string,
  localCurrencyLabel: string,
): MarketRegionOption[] {
  return regions.map((region) => ({
    value: region,
    label: regionLabel(region),
    currency:
      region === "all"
        ? localCurrencyLabel
        : REGION_LOCAL_CURRENCY[region.toLowerCase()] || "—",
  }));
}

export function marketCurrencyOptions(
  current: CurrencyPreference,
  localCurrencyLabel: string,
): MarketCurrencyOption[] {
  const values: CurrencyPreference[] = [...PRIMARY_MARKET_CURRENCIES];
  if (!values.includes(current)) values.push(current);
  return values.map((value) => ({
    value,
    label: value === "original" ? localCurrencyLabel : value,
  }));
}
