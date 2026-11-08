/**
 * Pure drag maths for the bottom sheet, kept out of the component so the snap
 * and dismiss rules can be tested without a touch device.
 *
 * Offsets are measured down from the fully expanded position: `0` is the
 * tallest detent, larger numbers sit lower, and `height` is fully off screen.
 * `restOffsets` is ordered the way the component builds it — index 0 is the
 * sheet's opening detent (the shortest one), the last entry is the tallest.
 */

/** Drag past this share of the travel below the tallest detent to dismiss. */
export const SHEET_DISMISS_RATIO = 0.35;
/** A downward fling faster than this dismisses regardless of distance. */
export const SHEET_DISMISS_VELOCITY = 1.1;
/** How far a release's velocity is projected when picking a detent. */
export const SHEET_VELOCITY_PROJECTION = 90;
/** Resistance applied when dragging above the tallest detent. */
const RUBBER_BAND_DIVISOR = 3;

export type SheetRelease = { kind: 'dismiss' } | { kind: 'settle'; offset: number };

type DragInput = {
  /** Offset the sheet rested at when the drag started. */
  resting: number;
  /** Vertical drag distance; positive is downward. */
  dy: number;
  restOffsets: number[];
  height: number;
};

export function sheetDragOffset({ resting, dy, height }: DragInput): number {
  const next = resting + dy;
  // Above the tallest detent the sheet resists instead of hard-stopping; below,
  // it can travel at most fully off screen.
  if (next < 0) return next / RUBBER_BAND_DIVISOR;
  return Math.min(next, height);
}

export function sheetRelease({
  resting,
  dy,
  velocity,
  restOffsets,
  height,
}: DragInput & { velocity: number }): SheetRelease {
  const released = resting + dy;
  // Dismissal is measured from the sheet's lowest resting position — the
  // shortest detent — so a small drag from there snaps back instead of closing.
  const lowestRest = Math.max(...restOffsets, 0);
  if (
    velocity > SHEET_DISMISS_VELOCITY
    || released > lowestRest + (height - lowestRest) * SHEET_DISMISS_RATIO
  ) {
    return { kind: 'dismiss' };
  }
  const projected = released + velocity * SHEET_VELOCITY_PROJECTION;
  const offset = restOffsets.reduce((best, candidate) =>
    Math.abs(candidate - projected) < Math.abs(best - projected) ? candidate : best,
  );
  return { kind: 'settle', offset };
}

/**
 * Resting offsets for a set of detents, given as shares of the screen. The
 * sheet is laid out at the tallest detent, so every shorter one rests that much
 * further down.
 */
export function sheetRestOffsets(detents: number[], screenHeight: number): number[] {
  if (!detents.length) return [0];
  const sorted = [...new Set(detents)].sort((left, right) => left - right);
  const tallest = screenHeight * sorted[sorted.length - 1]!;
  return sorted.map((stop) => tallest - screenHeight * stop);
}
