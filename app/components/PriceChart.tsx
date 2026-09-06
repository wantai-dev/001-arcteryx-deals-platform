import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { usePreferences } from '../contexts/PreferencesContext';
import { useTheme } from '../contexts/ThemeContext';
import { radii, typography, type ThemeColors } from '../lib/theme';
import type { ChartPoint, Product } from '../lib/types';

type Props = {
  points: ChartPoint[];
  product: Product;
};

const W = 320;
const H = 168;
const PAD_L = 42;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;

export function PriceChart({ points, product }: Props) {
  const { convertValue, displayedCurrency, formatMoney, formatNumber, t } = usePreferences();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('chart.notEnough')}</Text>
      </View>
    );
  }

  const displayPoints = points.map((point) => ({ ...point, sale: convertValue(point.sale, product.currency), original: convertValue(point.original, product.currency) }));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const prices = displayPoints.flatMap((point) => [point.sale, point.original].filter((value) => value > 0));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const yMin = Math.max(0, min - range * 0.1);
  const yMax = max + range * 0.1;
  const yRange = yMax - yMin;
  const xOf = (index: number) => PAD_L + (displayPoints.length === 1 ? innerW / 2 : (index / (displayPoints.length - 1)) * innerW);
  const yOf = (value: number) => PAD_T + innerH - ((value - yMin) / yRange) * innerH;
  const salePath = displayPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(1)} ${yOf(point.sale).toFixed(1)}`).join(' ');
  const minPrice = Math.min(...displayPoints.map((point) => point.sale));
  const sourceMinPrice = Math.min(...points.map((point) => point.sale));
  const minY = yOf(minPrice).toFixed(1);
  const last = displayPoints[displayPoints.length - 1]!;
  const lastX = xOf(displayPoints.length - 1);
  const lastY = yOf(last.sale);
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = Array.from(new Set([0, Math.floor(displayPoints.length / 2), displayPoints.length - 1]));

  return (
    <View style={styles.wrap}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {yTicks.map((tick) => {
          const y = yOf(tick);
          return (
            <G key={tick}>
              <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={colors.hair} strokeWidth={1} />
              <SvgText x={PAD_L - 6} y={y + 4} textAnchor="end" fill={colors.faint} fontSize={10} fontFamily={typography.mono}>
                {formatNumber(tick)}
              </SvgText>
            </G>
          );
        })}
        <Line x1={PAD_L} y1={minY} x2={W - PAD_R} y2={minY} stroke={colors.faint} strokeDasharray="4 5" strokeWidth={1.2} />
        <Path d={salePath} fill="none" stroke={colors.muted} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={lastX} cy={lastY} r={8} fill="none" stroke={colors.disc} strokeOpacity={0.42} strokeWidth={1.4} />
        <Circle cx={lastX} cy={lastY} r={4.3} fill={colors.disc} />
        {xTicks.map((index) => (
          <SvgText key={`${displayPoints[index]?.day}-${index}`} x={xOf(index)} y={H - 7} textAnchor="middle" fill={colors.faint} fontSize={10} fontFamily={typography.mono}>
            {displayPoints[index]?.day.slice(5)}
          </SvgText>
        ))}
      </Svg>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          <Text style={styles.lowSwatch}>━ </Text>
          {t('chart.low')} · <Text style={styles.legendMono}>{formatMoney(sourceMinPrice, product.currency, product.symbol)}</Text>
        </Text>
        <Text style={styles.legendText}>{t('chart.points', { count: points.length, currency: displayedCurrency(product.currency) })}</Text>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    paddingTop: 8,
    overflow: 'hidden',
  },
  empty: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  emptyText: {
    color: colors.muted,
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  legendText: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '700',
  },
  lowSwatch: {
    color: colors.faint,
  },
  legendMono: {
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
  },
}); }
