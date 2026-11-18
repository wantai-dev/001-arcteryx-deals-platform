import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHEET_DISMISS_VELOCITY,
  sheetDragOffset,
  sheetRelease,
  sheetRestOffsets,
} from '../lib/sheetGesture';

// A 0.6/0.9 sheet on an 800pt screen: laid out 720 tall, resting 240 down at
// the medium detent and 0 at the large one.
const SCREEN = 800;
const REST = sheetRestOffsets([0.6, 0.9], SCREEN);
const HEIGHT = SCREEN * 0.9;

test('detents become resting offsets measured from the tallest one', () => {
  assert.deepEqual(REST, [240, 0]);
  assert.deepEqual(sheetRestOffsets([0.9, 0.6], SCREEN), [240, 0], 'order of input must not matter');
  assert.deepEqual(sheetRestOffsets([], SCREEN), [0]);
  assert.deepEqual(sheetRestOffsets([0.5], SCREEN), [0], 'a single detent rests fully expanded');
});

test('dragging down tracks the finger and dragging up rubber-bands', () => {
  assert.equal(sheetDragOffset({ resting: 240, dy: 60, restOffsets: REST, height: HEIGHT }), 300);
  assert.equal(sheetDragOffset({ resting: 0, dy: -90, restOffsets: REST, height: HEIGHT }), -30);
  assert.equal(sheetDragOffset({ resting: 240, dy: -240, restOffsets: REST, height: HEIGHT }), 0);
});

test('a small drag snaps back to the detent it came from', () => {
  assert.deepEqual(
    sheetRelease({ resting: 240, dy: 30, velocity: 0, restOffsets: REST, height: HEIGHT }),
    { kind: 'settle', offset: 240 },
  );
});

test('dragging most of the way up snaps to the taller detent', () => {
  assert.deepEqual(
    sheetRelease({ resting: 240, dy: -160, velocity: 0, restOffsets: REST, height: HEIGHT }),
    { kind: 'settle', offset: 0 },
  );
});

test('an upward flick promotes to the taller detent before the halfway point', () => {
  const slow = sheetRelease({ resting: 240, dy: -100, velocity: 0, restOffsets: REST, height: HEIGHT });
  const flicked = sheetRelease({ resting: 240, dy: -100, velocity: -1, restOffsets: REST, height: HEIGHT });
  assert.deepEqual(slow, { kind: 'settle', offset: 240 });
  assert.deepEqual(flicked, { kind: 'settle', offset: 0 });
});

test('dragging past the dismiss threshold below the shortest detent dismisses', () => {
  // Shortest detent is 240; threshold is 240 + (720 - 240) * 0.35 = 408.
  assert.deepEqual(
    sheetRelease({ resting: 240, dy: 160, velocity: 0, restOffsets: REST, height: HEIGHT }),
    { kind: 'settle', offset: 240 },
  );
  assert.deepEqual(
    sheetRelease({ resting: 240, dy: 180, velocity: 0, restOffsets: REST, height: HEIGHT }),
    { kind: 'dismiss' },
  );
});

test('a fast downward fling dismisses even from a short drag', () => {
  assert.deepEqual(
    sheetRelease({
      resting: 240,
      dy: 12,
      velocity: SHEET_DISMISS_VELOCITY + 0.01,
      restOffsets: REST,
      height: HEIGHT,
    }),
    { kind: 'dismiss' },
  );
  assert.deepEqual(
    sheetRelease({
      resting: 240,
      dy: 12,
      velocity: SHEET_DISMISS_VELOCITY,
      restOffsets: REST,
      height: HEIGHT,
    }),
    { kind: 'settle', offset: 240 },
  );
});

test('a content-hugging sheet has one stop and only dismisses', () => {
  const hug = [0];
  const height = 300;
  assert.deepEqual(
    sheetRelease({ resting: 0, dy: 60, velocity: 0, restOffsets: hug, height }),
    { kind: 'settle', offset: 0 },
  );
  assert.deepEqual(
    sheetRelease({ resting: 0, dy: 120, velocity: 0, restOffsets: hug, height }),
    { kind: 'dismiss' },
  );
});
