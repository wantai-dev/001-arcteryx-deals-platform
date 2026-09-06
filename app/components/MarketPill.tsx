import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { regionFlag } from '../lib/catalog';
import { typography, type ThemeColors } from '../lib/theme';

export function MarketPill({ region, currency, label, onPress }: { region: string; currency: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.pill} onPress={onPress}>
      <Text style={styles.flag}>{regionFlag(region)}</Text>
      <Text style={styles.text}>{region === 'all' ? 'ALL' : region.toUpperCase()} · {currency === 'original' ? 'LOCAL' : currency}</Text>
      <Ionicons name="chevron-down" size={12} color={colors.ink} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, backgroundColor: colors.card, paddingHorizontal: 11 },
  flag: { fontSize: 13 }, text: { color: colors.ink, fontFamily: typography.mono, fontSize: 10.5, fontWeight: '800' },
});
