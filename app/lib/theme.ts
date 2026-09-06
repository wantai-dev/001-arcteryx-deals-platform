import { Platform, type ColorValue, type TextStyle } from 'react-native';

export const lightTokens = {
  screen: '#F6F7F4',
  card: '#FFFFFF',
  ink: '#15181B',
  ink2: '#3B4147',
  muted: '#626970',
  faint: '#626970',
  hair: 'rgba(20,25,28,.10)',
  hair2: 'rgba(20,25,28,.16)',
  disc: '#B5362A',
  discBg: '#F7E9E6',
  discLine: '#E7B7AF',
  buy: '#1E7A52',
  buyBg: '#E6F0E9',
  buyLine: '#AFD3BF',
  topo: 'rgba(20,25,28,.09)',
  photo: '#F1F0EC',
  photoTopo: 'rgba(20,25,28,.085)',
  photoCat: '#938E84',
  onPhotoDisc: '#A6321F',
  onPhotoBadge: 'rgba(255,255,255,.90)',
  photoDot: '#8F8A80',
  pill: '#15181B',
  onPill: '#F6F7F4',
  overlay: 'rgba(246,247,244,.62)',
};

export const darkTokens = {
  screen: '#141719',
  card: '#1D2124',
  ink: '#ECEEE9',
  ink2: '#C4C9CD',
  muted: '#AEB5BB',
  faint: '#AEB5BB',
  hair: 'rgba(255,255,255,.11)',
  hair2: 'rgba(255,255,255,.17)',
  disc: '#F08579',
  discBg: '#3A211D',
  discLine: '#5E332C',
  buy: '#5FBE8D',
  buyBg: '#16281F',
  buyLine: '#2C4A39',
  topo: 'rgba(255,255,255,.07)',
  photo: '#F1F0EC',
  photoTopo: 'rgba(20,25,28,.085)',
  photoCat: '#938E84',
  onPhotoDisc: '#A6321F',
  onPhotoBadge: 'rgba(255,255,255,.90)',
  photoDot: '#8F8A80',
  pill: '#ECEEE9',
  onPill: '#141719',
  overlay: 'rgba(20,23,25,.68)',
};

function adaptive(light: string, dark: string): ColorValue {
  if (Platform.OS !== 'ios') return light;
  const { DynamicColorIOS } = require('react-native') as typeof import('react-native');
  return DynamicColorIOS({ light, dark });
}

export const tokens = Object.fromEntries(
  Object.keys(lightTokens).map((key) => [
    key,
    adaptive(lightTokens[key as keyof typeof lightTokens], darkTokens[key as keyof typeof darkTokens]),
  ]),
) as Record<keyof typeof lightTokens, ColorValue>;

export const colors = {
  ...tokens,
  bg: tokens.screen,
  surface: tokens.card,
  surfaceAlt: tokens.screen,
  ink2: tokens.ink2,
  border: tokens.hair,
  borderStrong: tokens.hair2,
  accent: tokens.pill,
  accentSoft: tokens.buyBg,
  danger: tokens.disc,
  dangerSoft: tokens.discBg,
  dangerLine: tokens.discLine,
  success: tokens.buy,
  successSoft: tokens.buyBg,
  successLine: tokens.buyLine,
  tab: tokens.pill,
};
export type ThemeColors = typeof colors;
export function themeColors(scheme: 'light' | 'dark'): ThemeColors {
  const selected = scheme === 'dark' ? darkTokens : lightTokens;
  return { ...selected, bg: selected.screen, surface: selected.card, surfaceAlt: selected.screen, border: selected.hair, borderStrong: selected.hair2, accent: selected.pill, accentSoft: selected.buyBg, danger: selected.disc, dangerSoft: selected.discBg, dangerLine: selected.discLine, success: selected.buy, successSoft: selected.buyBg, successLine: selected.buyLine, tab: selected.pill };
}

export const radii = {
  sm: 6,
  md: 8,
  lg: 13,
  xl: 16,
};

export const typography = {
  mono: Platform.select({ ios: 'SF Mono', default: 'monospace' }) as string,
  tabular: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']>,
};

export const shadow = {
  shadowColor: '#101418',
  shadowOpacity: 0.05,
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 2,
  elevation: 1,
};
