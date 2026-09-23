/**
 * Dynamic Type support.
 *
 * React Native already scales a `<Text>`'s fontSize and lineHeight with the
 * system text size (`allowFontScaling` defaults to true), so the glyphs come
 * for free. What does not come for free is everything around them: a row with
 * a hard-coded 52pt height clips its own label at the larger sizes, an icon
 * beside scaled text looks undersized, and a two-column grid of cards stops
 * fitting a product name at all. These helpers scale those boxes.
 *
 * Apple's largest accessibility size is roughly a 3.1x multiplier. Growing
 * every box by that much wastes the screen, so container growth is damped and
 * capped while the text itself keeps scaling.
 */

/** Scale at which iOS switches to its accessibility text sizes. */
export const ACCESSIBILITY_FONT_SCALE = 1.35;

/** Ceilings for `maxFontSizeMultiplier`, by how much room the text has. */
export const TYPE_CAP = {
  /** Badges and pills sized to their own text; beyond this they swamp a card. */
  badge: 1.5,
  /** One-line metadata that may truncate. */
  compact: 1.8,
  /** Body copy and headings that own their line. */
  standard: 2.4,
} as const;

/**
 * Grow a fixed dimension for the current text size.
 *
 * Boxes only need to grow by the part of the scale that the text actually
 * spends on extra line height, so growth is damped (`1 + (scale - 1) * damping`)
 * and clamped, which keeps a 44pt tap target from becoming a 136pt one.
 */
export function scaleLength(
  value: number,
  fontScale: number,
  { max = 1.8, damping = 0.75 }: { max?: number; damping?: number } = {},
): number {
  if (!Number.isFinite(fontScale) || fontScale <= 1) return value;
  const damped = 1 + (fontScale - 1) * damping;
  return Math.round(value * Math.min(damped, max));
}

/** True once iOS is at an accessibility text size. */
export function isAccessibilityScale(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale >= ACCESSIBILITY_FONT_SCALE;
}

/**
 * Columns for a card grid. Apple's guidance is to collapse multi-column
 * layouts to one column at accessibility sizes rather than let each column
 * shrink below a readable width.
 */
export function gridColumns(fontScale: number, columns = 2): number {
  return isAccessibilityScale(fontScale) ? 1 : columns;
}
