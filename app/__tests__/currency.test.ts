import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCurrencyValue, formatCurrencyValueExplicit } from '../lib/currency';

test('explicit formatting names which dollar a price is in', () => {
  assert.equal(formatCurrencyValueExplicit(660, 'AUD', 'en-US'), 'A$660');
  assert.equal(formatCurrencyValueExplicit(520, 'CAD', 'en-US'), 'CA$520');
  assert.equal(formatCurrencyValueExplicit(400, 'USD', 'en-US'), 'US$400');
  assert.equal(formatCurrencyValueExplicit(4430.8, 'USD', 'zh-Hans'), 'US$4,430.8');
  // Symbol position still follows the locale.
  assert.match(formatCurrencyValueExplicit(400, 'USD', 'de-DE'), /^400\s?US\$$/u);
});

test('explicit formatting leaves non-dollar currencies unchanged', () => {
  for (const [value, currency, locale] of [[750, 'GBP', 'en-US'], [850, 'EUR', 'de-DE'], [6593.35, 'CNY', 'zh-Hans'], [9999, 'SEK', 'sv-SE']] as const) {
    assert.equal(formatCurrencyValueExplicit(value, currency, locale), formatCurrencyValue(value, currency, locale));
  }
});

test('explicit formatting never doubles a prefix the engine already added', () => {
  // Hermes has no formatToParts here and renders "US$" / "CA$" / "AU$" itself.
  const Real = Intl.NumberFormat;
  const symbols: Record<string, string> = { USD: 'US$', CAD: 'CA$', AUD: 'AU$' };
  class HermesLike {
    private readonly currency: string;
    constructor(_locale: string, options: Intl.NumberFormatOptions) {
      this.currency = String(options.currency);
    }
    format(value: number) {
      return `${symbols[this.currency]}${value}`;
    }
  }
  (Intl as { NumberFormat: unknown }).NumberFormat = HermesLike;
  try {
    assert.equal(formatCurrencyValueExplicit(60, 'USD', 'zh-Hans'), 'US$60');
    assert.equal(formatCurrencyValueExplicit(130, 'CAD', 'zh-Hans'), 'CA$130');
    assert.equal(formatCurrencyValueExplicit(660, 'AUD', 'zh-Hans'), 'A$660');
  } finally {
    (Intl as { NumberFormat: unknown }).NumberFormat = Real;
  }
});
