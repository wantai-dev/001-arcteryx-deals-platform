import { Ionicons } from '@expo/vector-icons';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { regionFlag } from '../lib/catalog';
import type { CurrencyPreference } from '../lib/currency';
import { colors, radii } from '../lib/theme';

type RegionOption = { value: string; label: string; currency: string };
type Props = { visible: boolean; title: string; region: string; currency: CurrencyPreference; regions: RegionOption[]; currencies: Array<{ value: CurrencyPreference; label: string }>; ratesNote: string; catalogNote: string; applyLabel: string; onChangeRegion: (value: string) => void; onChangeCurrency: (value: CurrencyPreference) => void; onClose: () => void };

export function MarketSheet(props: Props) {
  return (
    <Modal visible={props.visible} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={props.onClose}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <View style={styles.head}><Text style={styles.title}>{props.title}</Text><Pressable style={styles.close} onPress={props.onClose}><Ionicons name="close" size={21} color={colors.ink} /></Pressable></View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {props.regions.map((option) => <Pressable key={option.value} style={styles.region} onPress={() => props.onChangeRegion(option.value)}><Text style={styles.flag}>{regionFlag(option.value)}</Text><View style={styles.regionCopy}><Text style={styles.regionName}>{option.label}</Text><Text style={styles.regionCurrency}>{option.currency}</Text></View>{props.region === option.value ? <Ionicons name="checkmark-circle" size={20} color={colors.buy} /> : <View style={styles.radio} />}</Pressable>)}
          <View style={styles.currencies}>{props.currencies.map((option) => { const active = option.value === props.currency; return <Pressable key={option.value} style={[styles.currency, active && styles.currencyActive]} onPress={() => props.onChangeCurrency(option.value)}><Text style={[styles.currencyText, active && styles.currencyTextActive]}>{option.label}</Text></Pressable>; })}</View>
          <Text style={styles.note}>{props.ratesNote}</Text><Text style={styles.note}>{props.catalogNote}</Text>
        </ScrollView>
        <Pressable style={styles.apply} onPress={props.onClose}><Text style={styles.applyText}>{props.applyLabel}</Text></Pressable>
      </View></View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,9,10,.42)' }, sheet: { maxHeight: '88%', gap: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.card, padding: 18, paddingBottom: 30 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.ink, fontSize: 20, fontWeight: '900' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, scroll: { flexShrink: 1 }, content: { gap: 8 },
  region: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingHorizontal: 4 }, flag: { fontSize: 18 }, regionCopy: { flex: 1 }, regionName: { color: colors.ink, fontSize: 14, fontWeight: '800' }, regionCurrency: { color: colors.muted, fontSize: 11.5 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong },
  currencies: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12 }, currency: { minHeight: 44, justifyContent: 'center', borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, paddingHorizontal: 13 }, currencyActive: { backgroundColor: colors.pill, borderColor: colors.pill }, currencyText: { color: colors.ink2, fontSize: 12, fontWeight: '800' }, currencyTextActive: { color: colors.onPill }, note: { color: colors.muted, fontSize: 11.5, lineHeight: 17 },
  apply: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.pill }, applyText: { color: colors.onPill, fontSize: 14, fontWeight: '900' },
});
