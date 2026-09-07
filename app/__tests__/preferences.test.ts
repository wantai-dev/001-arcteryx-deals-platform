import assert from 'node:assert/strict';
import test from 'node:test';

import { convertAmount, formatCurrencyValue, parseRateRows } from '../lib/currency';
import { LANGUAGE_OPTIONS, localizedCategory, localizedRegion, missingTranslationKeys, resolveLanguage, translate } from '../lib/i18n';

const snapshot = parseRateRows(
  [
    { date: '2026-07-10', base: 'EUR', quote: 'USD', rate: 1.2 },
    { date: '2026-07-10', base: 'EUR', quote: 'CAD', rate: 1.6 },
  ],
  '2026-07-10T12:00:00Z',
);

test('system language resolves to a supported locale with English fallback', () => {
  assert.equal(resolveLanguage('system', 'zh'), 'zh-Hans');
  assert.equal(resolveLanguage('system', 'de'), 'de');
  assert.equal(resolveLanguage('system', 'es'), 'en');
  assert.equal(resolveLanguage('ja', 'en'), 'ja');
});

test('translations interpolate values and localize catalog labels', () => {
  assert.equal(translate('zh-Hans', 'deals.loadedShown', { loaded: '100', shown: '25' }), '已加载 100 · 显示 25');
  assert.equal(translate('zh-Hans', 'brand.name'), '值de');
  assert.equal(translate('en', 'brand.name'), 'GearDrop');
  assert.equal(translate('de', 'privacy.title'), 'Datenschutz');
  assert.equal(localizedCategory('ja', '裤装'), 'パンツ');
  assert.equal(localizedCategory('zh-Hans', 'footwear'), '鞋履');
  assert.equal(localizedCategory('de', 'footwear'), 'Schuhe');
  assert.equal(localizedCategory('fr', '滑雪板'), 'Snowboards');
  assert.equal(localizedCategory('ja', 'binding-parts'), 'バインディングパーツ');
  assert.equal(localizedCategory('en', 'baselayers'), 'Base Layers');
  assert.equal(localizedCategory('en', 'l-s-button-down-shirts'), 'Long-Sleeve Button-Down Shirts');
  assert.equal(localizedCategory('en', 'slings'), 'Sling Bags');
  assert.equal(localizedCategory('en', 'sun-shirts-rashguards'), 'Sun Shirts & Rashguards');
  assert.equal(localizedCategory('zh-Hans', 'booties'), '软底鞋');
  assert.equal(localizedCategory('de', 'water-protective-bags'), 'Schutztaschen für Wasseraktivitäten');
  assert.deepEqual(
    (['en', 'zh-Hans', 'de', 'fr', 'ja'] as const).map((language) => localizedCategory(language, 'other')),
    ['Other', '其他', 'Sonstiges', 'Autres', 'その他'],
  );
  assert.deepEqual(
    (['en', 'zh-Hans', 'de', 'fr', 'ja'] as const).map((language) => localizedCategory(language, '泳装')),
    ['Swimwear', '泳装', 'Badebekleidung', 'Maillots de bain', 'スイムウェア'],
  );
  assert.equal(localizedRegion('zh-Hans', 'fi'), '芬兰');
  assert.equal(localizedRegion('de', 'ie'), 'Irland');
  assert.equal(localizedRegion('fr', 'au'), 'Australie');
  assert.equal(localizedRegion('ja', 'ch'), 'スイス');
  assert.equal(localizedRegion('en', 'xx'), 'XX');
});

test('all current production deal categories avoid Chinese-label leakage in non-Chinese locales', () => {
  const activeDealCategories = [
    '上衣/T恤', '保暖夹克', '其他', '固定器', '夹克/外套', '抓绒/摇粒绒', '排汗内衣', '滑雪板',
    '硬壳冲锋衣', '背包', '背心', '裙装', '裤装', '西装/西服', '配件', '鞋类',
  ];
  for (const language of ['en', 'de', 'fr', 'ja'] as const) {
    for (const category of activeDealCategories) {
      assert.notEqual(localizedCategory(language, category), category, `${language}:${category}`);
    }
  }
});

test('every shipped language covers the complete UI message catalog', () => {
  for (const language of LANGUAGE_OPTIONS) {
    if (language === 'system') continue;
    assert.deepEqual(missingTranslationKeys(language), [], `${language} is missing translations`);
  }
});

test('product comparison copy interpolates source price, rate date, and merchant in all languages', () => {
  for (const language of ['en', 'zh-Hans', 'de', 'fr', 'ja'] as const) {
    const estimate = translate(language, 'product.convertedEstimate', { price: 'US$100', date: '2026-09-07' });
    const buyFrom = translate(language, 'product.buyFrom', { source: 'Example' });
    assert.ok(estimate.includes('US$100') && estimate.includes('2026-09-07'), language);
    assert.ok(buyFrom.includes('Example'), language);
    assert.notEqual(translate(language, 'product.comparisonUnavailable'), 'product.comparisonUnavailable', language);
  }
});

test('EUR-base rates convert between non-EUR currencies', () => {
  assert.ok(snapshot);
  const converted = convertAmount(120, 'USD', 'CAD', snapshot);
  assert.equal(converted.currency, 'CAD');
  assert.equal(converted.converted, true);
  assert.ok(Math.abs(converted.value - 160) < 0.0001);
});

test('missing rates fall back to the source amount and currency', () => {
  assert.deepEqual(convertAmount(100, 'SEK', 'USD', snapshot), { value: 100, currency: 'SEK', converted: false });
  assert.deepEqual(convertAmount(100, 'EUR', 'original', snapshot), { value: 100, currency: 'EUR', converted: false });
});

test('invalid amounts and rates never produce a converted value', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.deepEqual(convertAmount(value, 'USD', 'CAD', snapshot), { value, currency: 'USD', converted: false });
  }
  for (const badRate of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    const invalid = { date: '2026-07-10', fetchedAt: '2026-07-10T12:00:00Z', rates: { EUR: 1, USD: badRate, CAD: 1.6 } };
    assert.deepEqual(convertAmount(100, 'USD', 'CAD', invalid), { value: 100, currency: 'USD', converted: false });
  }
});

test('currency formatting follows locale and currency minor units', () => {
  assert.match(formatCurrencyValue(1234.5, 'USD', 'en-US'), /1,234\.5/);
  assert.match(formatCurrencyValue(1234.5, 'EUR', 'de-DE'), /1\.234,5/);
  assert.doesNotMatch(formatCurrencyValue(1234.5, 'JPY', 'ja-JP'), /\.5/);
});
