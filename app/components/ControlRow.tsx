import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import type { ThemeColors } from '../lib/theme';

type Props = {
  sortLabel: string;
  filterLabel: string;
  filterCount: number;
  onSort: () => void;
  onFilter: () => void;
};

export function ControlRow({ sortLabel, filterLabel, filterCount, onSort, onFilter }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={sortLabel} style={styles.sort} onPress={onSort}>
        <Text style={styles.sortText} numberOfLines={1}>{sortLabel}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.ink} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${filterLabel}, ${filterCount}`} style={styles.filter} onPress={onFilter}>
        <Ionicons name="options-outline" size={19} color={colors.ink} />
        {filterCount > 0 ? <View style={styles.count}><Text style={styles.countText}>{filterCount}</Text></View> : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sort: { minHeight: 44, maxWidth: '78%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortText: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  filter: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, backgroundColor: colors.card },
  count: { position: 'absolute', right: -4, top: -4, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 2, borderColor: colors.screen, backgroundColor: colors.disc, paddingHorizontal: 3 },
  countText: { color: '#fff', fontSize: 9, fontWeight: '900' },
});
