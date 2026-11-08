import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCESSIBILITY_FONT_SCALE,
  gridColumns,
  isAccessibilityScale,
  scaleLength,
  TYPE_CAP,
} from '../lib/typeScale';

test('the default text size leaves every box untouched', () => {
  assert.equal(scaleLength(44, 1), 44);
  assert.equal(scaleLength(52, 1), 52);
  assert.equal(gridColumns(1), 2);
  assert.equal(isAccessibilityScale(1), false);
});

test('a smaller-than-default text size never shrinks a tap target', () => {
  assert.equal(scaleLength(44, 0.8), 44);
  assert.equal(scaleLength(44, 0.88), 44);
});

test('boxes grow with the text but slower than it', () => {
  // 1.5x text grows a 44pt row by 1 + 0.5 * 0.75 = 1.375x, not 1.5x.
  assert.equal(scaleLength(44, 1.5), 61);
  assert.ok(scaleLength(44, 1.5) < 44 * 1.5);
  assert.ok(scaleLength(44, 1.5) > 44);
});

test('growth is capped so a huge text size cannot swallow the screen', () => {
  // Apple's largest accessibility size is ~3.1x; the default ceiling is 1.8x.
  assert.equal(scaleLength(44, 3.1), Math.round(44 * 1.8));
  assert.equal(scaleLength(44, 10), Math.round(44 * 1.8));
  assert.equal(scaleLength(44, 3.1, { max: 1.3 }), Math.round(44 * 1.3));
});

test('a non-finite scale is ignored rather than producing NaN layout', () => {
  assert.equal(scaleLength(44, Number.NaN), 44);
  assert.equal(scaleLength(44, Number.POSITIVE_INFINITY), 44);
  assert.equal(isAccessibilityScale(Number.NaN), false);
});

test('the card grid collapses to one column at the accessibility sizes', () => {
  assert.equal(gridColumns(ACCESSIBILITY_FONT_SCALE - 0.01), 2);
  assert.equal(gridColumns(ACCESSIBILITY_FONT_SCALE), 1);
  assert.equal(gridColumns(2.5), 1);
  assert.equal(gridColumns(2.5, 3), 1);
  assert.equal(gridColumns(1, 3), 3);
});

test('text caps stay above 1 and rank by how much room the text has', () => {
  assert.ok(TYPE_CAP.badge > 1);
  assert.ok(TYPE_CAP.badge < TYPE_CAP.compact);
  assert.ok(TYPE_CAP.compact < TYPE_CAP.standard);
});
