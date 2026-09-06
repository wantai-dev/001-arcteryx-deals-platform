import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { useTheme } from '../contexts/ThemeContext';
import { BRAND, BRAND_OPTIONS, CATEGORY_ORDER, GENDER_OPTIONS, PLATFORM, SORT_OPTIONS } from '../lib/catalog';
import { browseText } from '../lib/browseI18n';
import type { DealFilters } from '../lib/deals';
import { radii, type ThemeColors } from '../lib/theme';
import { ControlRow } from './ControlRow';
import { FilterSheet, type FilterSheetSection } from './FilterSheet';

type Props = {
  value: DealFilters;
  brands: string[];
  platforms: string[];
  categories: string[];
  series?: string[];
  resultCount?: number;
  lowScanPending?: boolean;
  onChange: (next: Partial<DealFilters>) => void;
};

export function FilterChips({ value, brands, platforms, categories, resultCount = 0, lowScanPending = false, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categoryLabel, genderLabel, language, t } = usePreferences();
  const b = (key: Parameters<typeof browseText>[1], params?: Record<string, string | number>) => browseText(language, key, params);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const availableBrands = useMemo(() => new Set(brands), [brands]);
  const sortedCategories = useMemo(() => categories.slice().sort((a, c) => {
    const ai = CATEGORY_ORDER.indexOf(a); const ci = CATEGORY_ORDER.indexOf(c);
    return (ai < 0 ? 999 : ai) - (ci < 0 ? 999 : ci) || a.localeCompare(c);
  }), [categories]);
  const active = [
    value.brand !== 'all' ? { key: 'brand', label: BRAND[value.brand as keyof typeof BRAND]?.label || value.brand, clear: { brand: 'all' } } : null,
    value.platform !== 'all' ? { key: 'platform', label: PLATFORM[value.platform]?.label || value.platform, clear: { platform: 'all' } } : null,
    value.category !== 'all' ? { key: 'category', label: categoryLabel(value.category), clear: { category: 'all' } } : null,
    value.gender !== 'all' ? { key: 'gender', label: genderLabel(value.gender), clear: { gender: 'all' } } : null,
    (value.minDiscount ?? 0) > 0 ? { key: 'discount', label: value.minDiscount === 50 ? b('fiftyOff') : b('thirtyOff'), clear: { minDiscount: 0 } } : null,
    value.lowOnly ? { key: 'lowOnly', label: lowScanPending ? b('loadingLows') : b('lowsOnly'), clear: { lowOnly: false } } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: Partial<DealFilters> }>;

  const sections: FilterSheetSection[] = [
    { key: 'brand', title: b('brand'), value: value.brand, options: BRAND_OPTIONS.filter((option) => option === 'all' || availableBrands.has(option)).map((option) => ({ value: option, label: option === 'all' ? b('allBrands') : BRAND[option as keyof typeof BRAND]?.label || option })) },
    { key: 'platform', title: b('source'), value: value.platform, options: ['all', ...platforms.slice().sort()].map((option) => ({ value: option, label: option === 'all' ? b('allSources') : PLATFORM[option]?.label || option })) },
    { key: 'category', title: b('category'), value: value.category, options: ['all', ...sortedCategories].map((option) => ({ value: option, label: option === 'all' ? b('allCategories') : categoryLabel(option) })) },
    { key: 'gender', title: b('gender'), value: value.gender, options: GENDER_OPTIONS.map((option) => ({ value: option, label: option === 'all' ? b('allGenders') : genderLabel(option) })) },
    { key: 'minDiscount', title: b('discount'), value: String(value.minDiscount ?? 0), options: [{ value: '0', label: b('anyDiscount') }, { value: '30', label: b('thirtyOff') }, { value: '50', label: b('fiftyOff') }] },
    { key: 'lowOnly', title: b('lowsOnly'), value: value.lowOnly ? 'true' : 'false', options: [{ value: 'false', label: b('anyDiscount') }, { value: 'true', label: b('lowsOnly') }] },
  ];

  return (
    <View style={styles.wrap}>
      <ControlRow sortLabel={`${b('sort')} · ${t(`sort.${value.sort}`)}`} filterLabel={b('filters')} filterCount={active.length} onSort={() => setSortOpen(true)} onFilter={() => setFilterOpen(true)} />
      {active.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeRow}>{active.map((chip) => <Pressable key={chip.key} hitSlop={4} style={styles.activeChip} onPress={() => onChange(chip.clear)}><Text style={styles.activeText} numberOfLines={1}>{chip.label}</Text><Ionicons name="close" size={13} color={colors.disc} /></Pressable>)}</ScrollView> : null}
      <SortSheet visible={sortOpen} value={value.sort} title={b('sort')} getLabel={(option) => t(`sort.${option}`)} onSelect={(sort) => { onChange({ sort }); setSortOpen(false); }} onClose={() => setSortOpen(false)} />
      <FilterSheet visible={filterOpen} title={b('filters')} sections={sections} resultLabel={b('viewResults', { count: resultCount })} resetLabel={b('reset')} onSelect={(key, next) => {
        if (key === 'minDiscount') onChange({ minDiscount: Number(next) as 0 | 30 | 50 });
        else if (key === 'lowOnly') onChange({ lowOnly: next === 'true' });
        else onChange({ [key]: next });
      }} onReset={() => onChange({ brand: 'all', platform: 'all', category: 'all', gender: 'all', series: 'all', minDiscount: 0, lowOnly: false })} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

function SortSheet({ visible, value, title, getLabel, onSelect, onClose }: { visible: boolean; value: string; title: string; getLabel: (value: string) => string; onSelect: (value: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={onClose}><View style={styles.backdrop}><View style={styles.sortSheet}><View style={styles.sortHead}><Text style={styles.sortTitle}>{title}</Text><Pressable style={styles.close} onPress={onClose}><Ionicons name="close" size={21} color={colors.ink} /></Pressable></View>{SORT_OPTIONS.map((option) => <Pressable key={option} style={styles.sortOption} onPress={() => onSelect(option)}><Text style={[styles.sortOptionText, option === value && styles.sortOptionActive]}>{getLabel(option)}</Text>{option === value ? <Ionicons name="checkmark" size={18} color={colors.buy} /> : null}</Pressable>)}</View></View></Modal>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: 7 }, activeRow: { minHeight: 36, gap: 7, paddingRight: 4 }, activeChip: { minHeight: 36, maxWidth: 190, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.discLine, backgroundColor: colors.discBg, paddingHorizontal: 9 }, activeText: { color: colors.disc, fontSize: 11.5, fontWeight: '800' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,9,10,.42)' }, sortSheet: { gap: 2, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.card, padding: 18, paddingBottom: 30 }, sortHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, sortTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, sortOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sortOptionText: { color: colors.ink2, fontSize: 14, fontWeight: '700' }, sortOptionActive: { color: colors.ink, fontWeight: '900' },
});
