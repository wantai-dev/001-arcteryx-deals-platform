import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProGate } from '../../components/ProGate';
import { AlertModal } from '../../components/AlertModal';
import { ScreenState } from '../../components/ScreenState';
import { TopoPlaceholder } from '../../components/TopoPlaceholder';
import { useProducts } from '../../contexts/ProductsContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { usePro } from '../../contexts/ProContext';
import { useTheme } from '../../contexts/ThemeContext';
import { openBuyUrl } from '../../lib/actions';
import { fetchPriceCandidates } from '../../lib/alertProductSource';
import { productName } from '../../lib/catalog';
import { lowestComparableCandidate } from '../../lib/candidateComparison';
import { radii, typography, type ThemeColors } from '../../lib/theme';
import type { Product, WatchEntry } from '../../lib/types';
import type { PriceCandidate } from '../../lib/priceMonitor';
import type { AlertDraft } from '../../lib/watchlist';
import { watchListCopy, watchCopy } from '../../lib/watchI18n';

type Row = { entry: WatchEntry; product?: Product };

export default function WatchlistScreen() {
  const watchlist = useWatchlist();
  const { isPro } = usePro();
  const { getProduct, products } = useProducts();
  const preferences = usePreferences();
  const { colors: palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const copy = watchListCopy(preferences.language);
  const runtimeCopy = watchCopy(preferences.language);
  const [candidates, setCandidates] = useState<PriceCandidate[]>([]);
  useEffect(() => {
    let active = true;
    fetchPriceCandidates(watchlist.entries).then((value) => { if (active) setCandidates(value); }).catch(() => { if (active) setCandidates([]); });
    return () => { active = false; };
  }, [watchlist.entries]);
  const rows = watchlist.entries
    .map((entry) => {
      const matches = candidates.filter((candidate) => entry.scope === 'model' ? candidate.modelKey === entry.modelKey : candidate.skuId === entry.skuId);
      const currentCandidate = lowestComparableCandidate(matches, preferences.rateSnapshot);
      return { entry, product: currentCandidate ? products.find((item) => item.sku_id === currentCandidate.skuId) : (entry.skuId ? getProduct(entry.skuId) : undefined), currentCandidate };
    })
    .sort((left, right) => Number(right.entry.scope === 'model') - Number(left.entry.scope === 'model'));
  const modelCount = rows.filter((row) => row.entry.scope === 'model').length;
  const skuCount = rows.length - modelCount;

  return <SafeAreaView style={styles.safe} edges={['top']}><FlatList
    data={rows}
    keyExtractor={(item) => item.entry.id || item.entry.skuId}
    contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={styles.header}><Text style={styles.title}>{copy.title}</Text><Text style={styles.subtitle}>{copy.summary(rows.length, watchlist.activeAlertCount)}</Text>{modelCount ? <Text style={styles.group}>{copy.models} · {modelCount}</Text> : null}</View>}
    ListEmptyComponent={<View style={styles.empty}><ScreenState title={copy.emptyTitle} body={copy.emptyBody} /><View style={styles.emptyActions}><Pressable style={styles.emptyButton} onPress={() => router.push('/(tabs)')}><Text style={styles.emptyButtonText}>{copy.goDeals}</Text></Pressable><Pressable style={styles.emptyButton} onPress={() => router.push('/(tabs)/yearbook')}><Text style={styles.emptyButtonText}>{copy.goYearbook}</Text></Pressable></View></View>}
    renderItem={({ item, index }) => <>
      {index === modelCount && skuCount && modelCount ? <Text style={styles.group}>{copy.items} · {skuCount}</Text> : null}
      <WatchRow row={item} styles={styles} palette={palette} onRemove={() => watchlist.removeEntry(item.entry.id!)} />
    </>}
    ListFooterComponent={<View style={styles.footer}>{!isPro ? <ProGate title={copy.freeLimit(watchlist.freeAlertLimit)} subtitle={copy.proUnlimited} action="Pro" /> : null}<Text style={styles.runtime}>{runtimeCopy.backgroundTiming} {runtimeCopy.killedWarning}</Text></View>}
  /></SafeAreaView>;
}

function WatchRow({ row, onRemove, styles, palette }: { row: Row & { currentCandidate?: PriceCandidate | null }; onRemove: () => void; styles: ReturnType<typeof createStyles>; palette: ThemeColors }) {
  const preferences = usePreferences();
  const copy = watchListCopy(preferences.language);
  const { entry, product } = row;
  const watchlist = useWatchlist();
  const [alertOpen, setAlertOpen] = useState(false);
  const snapshot = entry.snapshot;
  const name = product ? productName(product) : snapshot?.name || entry.skuId;
  const current = row.currentCandidate?.price ?? product?.sale_price ?? snapshot?.price ?? entry.savedPrice;
  const currency = row.currentCandidate?.currency ?? product?.currency ?? snapshot?.currency;
  const symbol = row.currentCandidate?.symbol ?? product?.symbol ?? snapshot?.symbol ?? entry.symbol;
  const currentVerified = Boolean(row.currentCandidate || product);
  const savedMoney = entry.savedMoney;
  const delta = savedMoney && currency === savedMoney.currency ? current - savedMoney.amount : null;
  const image = product?.image_url || snapshot?.imageUrl;
  const category = snapshot?.category || product?.category || copy.gear;
  const [imageFailed, setImageFailed] = useState(false);
  const currentPrice = product
    ? preferences.formatMoney(product.sale_price, product.currency, product.symbol)
    : preferences.formatMoney(current, currency || '', symbol);
  const alertSource = product || snapshot;
  const open = () => {
    const skuId = product?.sku_id || snapshot?.skuId;
    if (skuId) router.push({ pathname: '/product/[skuId]', params: { skuId } });
    else void openBuyUrl(snapshot?.sourceUrl);
  };
  return <Pressable style={styles.row} onPress={open} accessibilityRole="button">
    <View style={styles.thumb}><TopoPlaceholder label={category} showLabel={false} />{image && !imageFailed ? <Image source={{ uri: image }} style={styles.image} contentFit="cover" onError={() => setImageFailed(true)} /> : null}</View>
    <View style={styles.body}><View style={styles.rowHead}><View style={styles.scope}><Text style={styles.scopeText}>{entry.scope === 'model' ? copy.model : copy.item}</Text></View><Text style={styles.name} numberOfLines={2}>{name}</Text><Pressable accessibilityRole="button" accessibilityLabel={copy.remove} style={styles.remove} onPress={(event) => { event.stopPropagation(); onRemove(); }}><Ionicons name="close" size={18} color={palette.muted} /></Pressable></View>
      {currentVerified ? <Text style={[styles.delta, delta !== null && delta < 0 && styles.down]}>{delta === null ? copy.cannotCompare : Math.abs(delta) < 0.01 ? copy.noChange : copy.changed(delta < 0 ? '↓' : '↑', preferences.formatOriginalMoney(Math.abs(delta), currency || '', symbol))}</Text> : <Text style={styles.legacy}>{copy.unavailableNow}</Text>}
      <Pressable style={styles.alertButton} onPress={(event) => { event.stopPropagation(); setAlertOpen(true); }}><Ionicons name="notifications-outline" size={16} color={palette.ink2} /><Text style={styles.alertText}>{entry.alert ? `${copy.alertAt} ${preferences.formatOriginalMoney(entry.alert.targetAmount, entry.alert.targetCurrency)}` : copy.setAlert}</Text></Pressable>
      <Text style={styles.price}>{currentPrice} <Text style={styles.now}>{currentVerified ? copy.now : copy.savedPrice}</Text></Text>
    </View>
    {alertSource ? <AlertModal visible={alertOpen} source={alertSource} entry={entry} lockedScope={entry.scope || 'sku'} onClose={() => setAlertOpen(false)} onDelete={async () => watchlist.removeAlert(entry.id!)} onSubmit={(draft: AlertDraft) => watchlist.saveAlert(entry.id!, draft)} /> : null}
  </Pressable>;
}

function createStyles(c: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.screen }, content: { padding: 20, paddingBottom: 36 }, header: { gap: 3, marginBottom: 10 }, title: { color: c.ink, fontSize: 28, lineHeight: 34, fontWeight: '900' }, subtitle: { color: c.muted, fontSize: 13, fontWeight: '700' }, group: { color: c.ink2, marginTop: 15, marginBottom: 5, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .6 },
  row: { minHeight: 102, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair }, thumb: { width: 62, aspectRatio: 4 / 5, overflow: 'hidden', borderRadius: 11, backgroundColor: c.photo }, image: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%' }, body: { flex: 1 }, rowHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 }, name: { flex: 1, color: c.ink, fontSize: 13.5, lineHeight: 18, fontWeight: '800' }, scope: { borderRadius: 5, backgroundColor: c.buyBg, paddingHorizontal: 5, paddingVertical: 3 }, scopeText: { color: c.buy, fontSize: 9, fontWeight: '900' }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  delta: { color: c.muted, fontSize: 11.5, fontWeight: '800' }, down: { color: c.buy }, alert: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }, alertButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6 }, alertText: { color: c.ink2, fontSize: 11.5, fontWeight: '800' }, mono: { fontFamily: typography.mono, fontVariant: typography.tabular }, legacy: { color: c.muted, marginTop: 3, fontSize: 10.5 }, price: { color: c.ink, marginTop: 3, fontFamily: typography.mono, fontWeight: '800' }, now: { color: c.muted, fontFamily: undefined, fontSize: 10.5 }, footer: { gap: 10, marginTop: 16 }, runtime: { color: c.muted, fontSize: 11.5, lineHeight: 17 }, empty: { gap: 12 }, emptyActions: { flexDirection: 'row', gap: 10, justifyContent: 'center' }, emptyButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.pill }, emptyButtonText: { color: c.onPill, fontWeight: '900' },
}); }
