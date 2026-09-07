import assert from "node:assert/strict";
import test from "node:test";

import type { CurrencyPreference } from "../lib/currency";
import {
  marketCurrencyOptions,
  marketRegionOptions,
} from "../lib/marketOptions";

test("market regions show ISO local currencies and localize the all-regions row", () => {
  const options = marketRegionOptions(
    ["all", "au", "dk", "se", "jp"],
    (region) => `region:${region}`,
    "本地币种",
  );

  assert.deepEqual(
    options.map(({ value, currency }) => [value, currency]),
    [
      ["all", "本地币种"],
      ["au", "AUD"],
      ["dk", "DKK"],
      ["se", "SEK"],
      ["jp", "JPY"],
    ],
  );
  assert.equal(options.some(({ currency }) => currency === "original"), false);
});

test("market currency chips keep a previously saved supported currency selected", () => {
  for (const current of ["CAD", "GBP", "JPY", "CHF"] as CurrencyPreference[]) {
    const options = marketCurrencyOptions(current, "Local currency");
    assert.deepEqual(options.slice(0, 4).map(({ value }) => value), [
      "original",
      "CNY",
      "USD",
      "EUR",
    ]);
    assert.equal(options.at(-1)?.value, current);
    assert.equal(options.filter(({ value }) => value === current).length, 1);
  }
});

test("primary market currencies remain four shared options without duplicates", () => {
  assert.deepEqual(marketCurrencyOptions("EUR", "Devise locale"), [
    { value: "original", label: "Devise locale" },
    { value: "CNY", label: "CNY" },
    { value: "USD", label: "USD" },
    { value: "EUR", label: "EUR" },
  ]);
});
