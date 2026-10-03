import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGE_OPTIONS,
  hasLocalizedCategory,
  localizedCategory,
  localizedGender,
  type AppLanguage,
} from '../lib/i18n';

const LANGUAGES = LANGUAGE_OPTIONS.filter((value): value is AppLanguage => value !== 'system');

test('every supported language labels the kids audience', () => {
  const gaps = LANGUAGES.filter((language) => localizedGender(language, 'kids') === 'kids');
  assert.deepEqual(gaps, [], 'kids must not fall through to the raw key');
  assert.equal(localizedGender('zh-Hans', 'kids'), '童款');
  assert.equal(localizedGender('en', 'kids'), 'Kids');
});

test('official catalog slugs that reached production are translated everywhere', () => {
  const slugs = [
    '1-2-zips', '1-4-zips', 'crew-necks', 'full-zips', 'long-sleeve-shirts',
    'long-sleeve-t-shirts', 'polo-shirts', 'short-sleeve-shirts', 'short-sleeve-t-shirts',
  ];
  for (const slug of slugs) {
    assert.ok(hasLocalizedCategory(slug), `${slug} must be in the official category map`);
    for (const language of LANGUAGES) {
      assert.notEqual(localizedCategory(language, slug), slug, `${language}:${slug}`);
    }
  }
  assert.equal(localizedCategory('zh-Hans', 'short-sleeve-t-shirts'), '短袖 T 恤');
  assert.equal(localizedCategory('en', 'polo-shirts'), 'Polo Shirts');
});

test('an unmapped slug is title-cased instead of leaking kebab-case into menus', () => {
  assert.equal(hasLocalizedCategory('wind-shell-hoodies'), false);
  for (const language of LANGUAGES) {
    assert.equal(localizedCategory(language, 'wind-shell-hoodies'), 'Wind Shell Hoodies');
  }
});

test('Chinese deal categories still pass through untouched for Chinese readers', () => {
  assert.equal(localizedCategory('zh-Hans', '夹克/外套'), '夹克/外套');
  assert.equal(localizedCategory('en', '夹克/外套'), 'Jackets / outerwear');
});
