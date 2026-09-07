import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FREE_ALERT_LIMIT, FREE_WATCHLIST_LIMIT } from '../lib/watchlist';

type LocaleMetadata = {
  name: string;
  subtitle: string;
  promotionalText: string;
  keywords: string;
  description: string;
  whatsNew: string;
  screenshots: string[];
};

type StoreMetadataManifest = {
  schemaVersion: number;
  target: string;
  targetVersion: string;
  targetBuildNumber: string;
  appId: string;
  bundleId: string;
  primaryLocale: string;
  releaseBoundary: {
    applyToCurrentReview: boolean;
    requiresFreshAppStoreReadback: boolean;
    requiresFinalBuildScreenshots: boolean;
    requiresFreshScreenshotSetReadback: boolean;
  };
  shared: {
    category: string;
    supportUrl: string;
    privacyPolicyUrl: string;
    termsUrl: string;
  };
  screenshotSources: string[];
  screenshotTarget: {
    deviceClass: string;
    device: string;
    orientation: string;
    width: number;
    height: number;
    countPerLocale: number;
    requiresNoAlpha: boolean;
  };
  locales: Record<string, LocaleMetadata>;
};

const REQUIRED_LOCALES = ['en-US', 'zh-Hans', 'de-DE', 'fr-FR', 'ja'] as const;
const EXPECTED_SCREENSHOT_SOURCES = [
  'deals-feed',
  'product-detail-signal',
  'region-comparison',
  'watchlist',
  'pro-price-history',
  'yearbook-current-deals',
];
const SUPPORT_URL = 'https://geardrop.100app.dev/support.html';
const PRIVACY_URL = 'https://geardrop.100app.dev/privacy.html';
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const FORBIDDEN_PUBLIC_TERMS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Arc'teryx", pattern: /arc[’']?teryx/iu },
  { label: '始祖鸟', pattern: /始祖鸟/u },
  { label: 'Keepa', pattern: /\bkeepa\b/iu },
  { label: 'ShopSavvy', pattern: /\bshopsavvy\b/iu },
  { label: 'Slickdeals', pattern: /\bslickdeals\b/iu },
  { label: 'Backcountry', pattern: /\bbackcountry\b/iu },
  { label: 'REI', pattern: /\brei\b/iu },
  { label: 'Burton', pattern: /\bburton\b/iu },
  { label: 'Patagonia', pattern: /\bpatagonia\b/iu },
];
const REQUIRED_ACCESS_COPY: Record<(typeof REQUIRED_LOCALES)[number], string[]> = {
  'en-US': [
    'Low-price signals, summaries, and filters remain available on Free.',
    'GearDrop Pro unlocks 12 months of price history, unlimited price alerts, and unlimited saved items and models.',
  ],
  'zh-Hans': [
    '史低信号、摘要和筛选继续向免费用户开放。',
    '值de Pro 解锁 12 个月价格历史、不限量降价提醒，以及不限量收藏商品和型号。',
  ],
  'de-DE': [
    'Tiefpreis-Signale, Übersichten und Filter bleiben im Gratis-Modus verfügbar.',
    'GearDrop Pro schaltet 12 Monate Preisverlauf, unbegrenzte Preisalarme und unbegrenzt gespeicherte Artikel und Modelle frei.',
  ],
  'fr-FR': [
    'Les signaux de prix bas, résumés et filtres restent disponibles en version gratuite.',
    'GearDrop Pro débloque 12 mois d’historique des prix, des alertes de prix illimitées et un nombre illimité d’articles et modèles enregistrés.',
  ],
  ja: [
    '安値シグナル、概要、絞り込みは無料版でも利用できます。',
    'GearDrop Proでは12か月の価格履歴、無制限の価格通知、商品とモデルの無制限保存を利用できます。',
  ],
};

function characterCount(value: string) {
  return [...value].length;
}

function occurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function assertCharacterRange(value: string, minimum: number, maximum: number, label: string) {
  const count = characterCount(value);
  assert.ok(count >= minimum && count <= maximum, `${label} must be ${minimum}-${maximum} characters, got ${count}`);
}

function assertNoForbiddenTerms(value: string, label: string) {
  for (const forbidden of FORBIDDEN_PUBLIC_TERMS) {
    assert.ok(!forbidden.pattern.test(value), `${label} must not contain protected or competing term ${forbidden.label}`);
  }
}

const manifestPath = join(process.cwd(), 'store-metadata', 'next-version.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StoreMetadataManifest;

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.target, 'next-app-version');
assert.equal(manifest.targetVersion, '1.2.0');
assert.equal(manifest.targetBuildNumber, '14');
assert.equal(manifest.appId, '6790165332');
assert.equal(manifest.bundleId, 'dev.100app.geardrop');
assert.equal(manifest.primaryLocale, 'en-US');
assert.equal(manifest.releaseBoundary.applyToCurrentReview, false, 'ASO package must not target the current review');
assert.equal(manifest.releaseBoundary.requiresFreshAppStoreReadback, true);
assert.equal(manifest.releaseBoundary.requiresFinalBuildScreenshots, true);
assert.equal(manifest.releaseBoundary.requiresFreshScreenshotSetReadback, true);
assert.equal(manifest.shared.category, 'SHOPPING');
assert.equal(manifest.shared.supportUrl, SUPPORT_URL);
assert.equal(manifest.shared.privacyPolicyUrl, PRIVACY_URL);
assert.equal(manifest.shared.termsUrl, TERMS_URL);
assert.deepEqual(manifest.screenshotSources, EXPECTED_SCREENSHOT_SOURCES);
assert.equal(new Set(manifest.screenshotSources).size, EXPECTED_SCREENSHOT_SOURCES.length);
assert.deepEqual(manifest.screenshotTarget, {
  deviceClass: 'iPhone 6.9-inch',
  device: 'iPhone 16 Pro Max',
  orientation: 'portrait',
  width: 1320,
  height: 2868,
  countPerLocale: EXPECTED_SCREENSHOT_SOURCES.length,
  requiresNoAlpha: true,
});
assert.deepEqual(Object.keys(manifest.locales).sort(), [...REQUIRED_LOCALES].sort());
assert.equal(FREE_ALERT_LIMIT, 1, '1.2 metadata requires one free active alert');
assert.equal(FREE_WATCHLIST_LIMIT, 20, '1.2 metadata requires 20 free saved items/models');

for (const localeKey of REQUIRED_LOCALES) {
  const locale = manifest.locales[localeKey];
  assert.ok(locale, `missing locale ${localeKey}`);

  assertCharacterRange(locale.name, 2, 30, `${localeKey}.name`);
  assertCharacterRange(locale.subtitle, 1, 30, `${localeKey}.subtitle`);
  assertCharacterRange(locale.promotionalText, 1, 170, `${localeKey}.promotionalText`);
  assertCharacterRange(locale.description, 1, 4000, `${localeKey}.description`);
  assertCharacterRange(locale.whatsNew, 1, 4000, `${localeKey}.whatsNew`);
  for (const requiredCopy of REQUIRED_ACCESS_COPY[localeKey]) {
    assert.ok(locale.description.includes(requiredCopy), `${localeKey}.description must state the final Free/Pro access boundary`);
  }
  assert.ok(
    !/no longer appear|not in the current|已不在|不在当前|nicht mehr im aktuellen|nicht im aktuellen|absents? du catalogue|現行カタログにない|現行の公式.*にはありません/iu.test(`${locale.description}\n${locale.promotionalText}\n${locale.whatsNew}`),
    `${localeKey} must not claim unmatched deals are absent from the current official catalog`,
  );

  const keywordBytes = Buffer.byteLength(locale.keywords, 'utf8');
  assert.ok(keywordBytes <= 100, `${localeKey}.keywords must be at most 100 UTF-8 bytes, got ${keywordBytes}`);
  assert.ok(!/\s,|,\s/u.test(locale.keywords), `${localeKey}.keywords must use commas without surrounding spaces`);

  const keywords = locale.keywords.split(',');
  assert.equal(keywords.join(','), locale.keywords, `${localeKey}.keywords must not contain empty or normalized-away terms`);
  assert.equal(new Set(keywords.map((keyword) => keyword.toLocaleLowerCase(localeKey))).size, keywords.length, `${localeKey}.keywords must be unique`);
  for (const keyword of keywords) {
    assertCharacterRange(keyword, 3, 40, `${localeKey}.keyword(${keyword})`);
    assert.match(keyword, /^[\p{L}\p{N} -]+$/u, `${localeKey}.keyword(${keyword}) contains unsupported punctuation`);
    assert.ok(!/^(app|shopping)$/iu.test(keyword), `${localeKey}.keyword(${keyword}) must not repeat the app category or the word app`);
  }

  assert.equal(occurrences(locale.description, TERMS_URL), 1, `${localeKey}.description must include the standard EULA exactly once`);
  assert.equal(occurrences(locale.description, PRIVACY_URL), 1, `${localeKey}.description must include the privacy URL exactly once`);
  assert.ok(!/\$(?:3\.99|23\.99|49\.99)|€(?:3\.99|23\.99|49\.99)|¥(?:3\.99|23\.99|49\.99)/u.test(locale.description), `${localeKey}.description must not hardcode storefront prices`);
  assert.ok(!/real[- ]?time|instant(?:ly)?|in Echtzeit|sofort|temps réel|instantané|实时|即時|リアルタイム/iu.test(`${locale.promotionalText}\n${locale.description}\n${locale.whatsNew}`), `${localeKey} must not promise real-time or instant alerts`);
  assert.ok(!/free trial|kostenlose Test|essai gratuit|免费试用|無料トライアル/iu.test(`${locale.promotionalText}\n${locale.description}\n${locale.whatsNew}`), `${localeKey} must not promise trial eligibility`);

  assert.equal(locale.screenshots.length, EXPECTED_SCREENSHOT_SOURCES.length, `${localeKey}.screenshots must cover all six slots`);
  assert.equal(new Set(locale.screenshots).size, locale.screenshots.length, `${localeKey}.screenshots must use unique headlines`);
  for (const [index, headline] of locale.screenshots.entries()) {
    assertCharacterRange(headline, 3, 48, `${localeKey}.screenshots[${index}]`);
  }

  for (const [field, value] of Object.entries({
    name: locale.name,
    subtitle: locale.subtitle,
    promotionalText: locale.promotionalText,
    keywords: locale.keywords,
    description: locale.description,
    whatsNew: locale.whatsNew,
    screenshots: locale.screenshots.join('\n'),
  })) {
    assertNoForbiddenTerms(value, `${localeKey}.${field}`);
  }

  console.log(
    `${localeKey} name=${characterCount(locale.name)} subtitle=${characterCount(locale.subtitle)} ` +
      `promo=${characterCount(locale.promotionalText)} description=${characterCount(locale.description)} ` +
      `whatsNew=${characterCount(locale.whatsNew)} keywords=${keywordBytes}B screenshots=${locale.screenshots.length}`,
  );
}

console.log(
  `store_metadata_ok target=${manifest.targetVersion} build=${manifest.targetBuildNumber} locales=${REQUIRED_LOCALES.length} ` +
    `screenshots=${EXPECTED_SCREENSHOT_SOURCES.length} display=${manifest.screenshotTarget.deviceClass} currentReview=${manifest.releaseBoundary.applyToCurrentReview}`,
);
