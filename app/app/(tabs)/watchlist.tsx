import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProGate } from '../../components/ProGate';
import { ScreenState } from '../../components/ScreenState';
import { TopoPlaceholder } from '../../components/TopoPlaceholder';
import { useProducts } from '../../contexts/ProductsContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { useTheme } from '../../contexts/ThemeContext';
import { openBuyUrl } from '../../lib/actions';
import { productName } from '../../lib/catalog';
import { radii, typography, type ThemeColors } from '../../lib/theme';
import type { Product, WatchEntry } from '../../lib/types';
import { watchListCopy, watchCopy } from '../../lib/watchI18n';

type Row = { entry: WatchEntry; product?: Product };

export default function WatchlistScreen() {
  const watchlist = useWatchlist();
  const { getProduct } = useProducts();
  const preferences = usePreferences();
  const { colors: palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const copy = watchListCopy(preferences.language);
  const runtimeCopy = watchCopy(preferences.language);
  const rows = watchlist.entries
    .map((entry) => ({ entry, product: entry.skuId ? getProduct(entry.skuId) : undefined }))
    .sort((left, right) => Number(right.entry.scope === 'model') - Number(left.entry.scope === 'model'));
  const modelCount = rows.filter((row) => row.entry.scope === 'model').length;
  const skuCount = rows.length - modelCount;

  return <SafeAreaView style={styles.safe} edges={['top']}><FlatList
    data={rows}
    keyExtractor={(item) => item.entry.id || item.entry.skuId}
    contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={styles.header}><Text style={styles.title}>{copy.title}</Text><Text style={styles.subtitle}>{copy.summary(rows.length, watchlist.activeAlertCount)}</Text>{modelCount ? <Text style={styles.group}>{copy.models} · {modelCount}</Text> : null}</View>}
    ListEmptyComponent={<ScreenState title={copy.emptyTitle} body={copy.emptyBody} />}
    renderItem={({ item, index }) => <>
      {index === modelCount && skuCount && modelCount ? <Text style={styles.group}>{copy.items} · {skuCount}</Text> : null}
      <WatchRow row={item} styles={styles} palette={palette} onRemove={() => watchlist.removeEntry(item.entry.id!)} />
    </>}
    ListFooterComponent={<View style={styles.footer}><ProGate title={copy.freeLimit(watchlist.freeAlertLimit)} subtitle={copy.proUnlimited} action="Pro" /><Text style={styles.runtime}>{runtimeCopy.backgroundTiming} {runtimeCopy.killedWarning}</Text></View>}
  /></SafeAreaView>;
}

function WatchRow({ row, onRemove, styles, palette }: { row: Row; onRemove: () => void; styles: ReturnType<typeof createStyles>; palette: ThemeColors }) {
  const preferences = usePreferences();
  const copy = watchListCopy(preferences.language);
  const { entry, product } = row;
  const snapshot = entry.snapshot;
  const name = product ? productName(product) : snapshot?.name || entry.skuId;
  const current = product?.sale_price ?? snapshot?.price ?? entry.savedPrice;
  const currency = product?.currency ?? snapshot?.currency;
  const symbol = product?.symbol ?? snapshot?.symbol ?? entry.symbol;
  const savedMoney = entry.savedMoney;
  const delta = savedMoney && currency === savedMoney.currency ? current - savedMoney.amount : null;
  const image = product?.image_url || snapshot?.imageUrl;
  const category = snapshot?.category || product?.category || copy.gear;
  const [imageFailed, setImageFailed] = useState(false);
  const currentPrice = product
    ? preferences.formatMoney(product.sale_price, product.currency, product.symbol)
    : preferences.formatMoney(current, currency || '', symbol);
  const open = () => {
    const skuId = product?.sku_id || snapshot?.skuId;
    if (skuId) router.push({ pathname: '/product/[skuId]', params: { skuId } });
    else void openBuyUrl(snapshot?.sourceUrl);
  };
  return <Pressable style={styles.row} onPress={open} accessibilityRole="button">
    <View style={styles.thumb}><TopoPlaceholder label={category} showLabel={false} />{image && !imageFailed ? <Image source={{ uri: image }} style={styles.image} contentFit="cover" onError={() => setImageFailed(true)} /> : null}</View>
    <View style={styles.body}><View style={styles.rowHead}><View style={styles.scope}><Text style={styles.scopeText}>{entry.scope === 'model' ? copy.model : copy.item}</Text></View><Text style={styles.name} numberOfLines={2}>{name}</Text><Pressable accessibilityRole="button" accessibilityLabel={copy.remove} style={styles.remove} onPress={(event) => { event.stopPropagation(); onRemove(); }}><Ionicons name="close" size={18} color={palette.muted} /></Pressable></View>
      <Text style={[styles.delta, delta !== null && delta < 0 && styles.down]}>{delta === null || Math.abs(delta) < 0.01 ? copy.noChange : copy.changed(delta < 0 ? '↓' : '↑', preferences.formatOriginalMoney(Math.abs(delta), currency || '', symbol))}</Text>
      {entry.alert ? <View style={styles.alert}><Ionicons name="notifications-outline" size={13} color={palette.ink2} /><Text style={styles.alertText}>{copy.alertAt} <Text style={styles.mono}>{preferences.formatOriginalMoney(entry.alert.targetAmount, entry.alert.targetCurrency)}</Text></Text></View> : entry.alertTarget ? <Text style={styles.legacy}>{copy.legacyAlert}</Text> : null}
      <Text style={styles.price}>{currentPrice} <Text style={styles.now}>{copy.now}</Text></Text>
    </View>
  </Pressable>;
}

function createStyles(c: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.screen }, content: { padding: 20, paddingBottom: 36 }, header: { gap: 3, marginBottom: 10 }, title: { color: c.ink, fontSize: 28, lineHeight: 34, fontWeight: '900' }, subtitle: { color: c.muted, fontSize: 13, fontWeight: '700' }, group: { color: c.ink2, marginTop: 15, marginBottom: 5, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .6 },
  row: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair }, thumb: { width: 62, aspectRatio: 4 / 5, overflow: 'hidden', borderRadius: 11, backgroundColor: c.photo }, image: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%' }, body: { flex: 1 }, rowHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 }, name: { flex: 1, color: c.ink, fontSize: 13.5, lineHeight: 18, fontWeight: '800' }, scope: { borderRadius: 5, backgroundColor: c.buyBg, paddingHorizontal: 5, paddingVertical: 3 }, scopeText: { color: c.buy, fontSize: 9, fontWeight: '900' }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  delta: { color: c.muted, fontSize: 11.5, fontWeight: '800' }, down: { color: c.buy }, alert: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }, alertText: { color: c.ink2, fontSize: 11.5, fontWeight: '800' }, mono: { fontFamily: typography.mono, fontVariant: typography.tabular }, legacy: { color: c.muted, marginTop: 3, fontSize: 10.5 }, price: { color: c.ink, marginTop: 3, fontFamily: typography.mono, fontWeight: '800' }, now: { color: c.muted, fontFamily: undefined, fontSize: 10.5 }, footer: { gap: 10, marginTop: 16 }, runtime: { color: c.muted, fontSize: 11.5, lineHeight: 17 },
}); }
