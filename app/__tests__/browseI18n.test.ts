import assert from 'node:assert/strict';
import test from 'node:test';

import { browseText, type BrowseKey } from '../lib/browseI18n';
import type { AppLanguage } from '../lib/i18n';

test('browse controls and signal coverage are available in all five languages', () => {
  const languages: AppLanguage[] = ['en', 'zh-Hans', 'de', 'fr', 'ja'];
  const keys: BrowseKey[] = ['searchDeals', 'searchYearbook', 'filters', 'thirtyOff', 'fiftyOff', 'lowsOnly', 'loadingLows', 'signalCoverage', 'signalUnavailable', 'officialSource'];
  for (const language of languages) {
    for (const key of keys) {
      const value = browseText(language, key, { checked: 3, total: 9 });
      assert.ok(value.trim(), `${language}.${key}`);
      assert.equal(value.includes('{{'), false, `${language}.${key}`);
    }
  }
});

test('German long filter copy stays complete instead of truncating source strings', () => {
  assert.equal(browseText('de', 'allGenders'), 'Alle Zielgruppen');
  assert.equal(browseText('de', 'loadingLows'), 'Tiefstpreise werden geprüft…');
});
