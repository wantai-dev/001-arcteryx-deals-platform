import assert from 'node:assert/strict';
import test from 'node:test';

import { browseText, type BrowseKey } from '../lib/browseI18n';
import type { AppLanguage } from '../lib/i18n';

test('browse controls and signal coverage are available in all five languages', () => {
  const languages: AppLanguage[] = ['en', 'zh-Hans', 'de', 'fr', 'ja'];
  const keys: BrowseKey[] = ['searchDeals', 'searchYearbook', 'clearSearch', 'filters', 'thirtyOff', 'fiftyOff', 'lowsOnly', 'loadingLows', 'signalCoverage', 'signalUnavailable', 'officialSource', 'watchSaveErrorTitle', 'watchSaveErrorBody'];
  for (const language of languages) {
    for (const key of keys) {
      const value = browseText(language, key, { checked: 3, total: 9 });
      assert.ok(value.trim(), `${language}.${key}`);
      assert.equal(value.includes('{{'), false, `${language}.${key}`);
    }
  }
});

test('search clear accessibility label is localized in all five languages', () => {
  assert.deepEqual(
    (['en', 'zh-Hans', 'de', 'fr', 'ja'] as AppLanguage[]).map((language) =>
      browseText(language, 'clearSearch'),
    ),
    ['Clear search', '清除搜索', 'Suche löschen', 'Effacer la recherche', '検索を消去'],
  );
});

test('German long filter copy stays complete instead of truncating source strings', () => {
  assert.equal(browseText('de', 'allGenders'), 'Alle Zielgruppen');
  assert.equal(browseText('de', 'loadingLows'), 'Tiefstpreise werden geprüft…');
});
