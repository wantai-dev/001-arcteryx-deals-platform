import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLogo } from '../../components/BrandLogo';
import { DealCard } from '../../components/DealCard';
import { FilterChips } from '../../components/FilterChips';
import { MarketPill } from '../../components/MarketPill';
import { MarketSheet } from '../../components/MarketSheet';
import { ScreenState } from '../../components/ScreenState';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useProducts } from '../../contexts/ProductsContext';
import { useRegion } from '../../contexts/RegionContext';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { browseText } from '../../lib/browseI18n';
import { freshnessLabel, productCategory } from '../../lib/catalog';
import type { CurrencyPreference } from '../../lib/currency';
import { availableDealRegions, DEFAULT_DEAL_FILTERS, filterDeals, productsForRegion, type DealFilters } from '../../lib/deals';
import { colors } from '../../lib/theme';
import type { Product } from '../../lib/types';

const REGION_CURRENCY: Record<string, string> = { us: 'USD', ca: 'CAD', gb: 'GBP', au: 'AUD', de: 'EUR', fr: 'EUR', nl: 'EUR', fi: 'EUR', ie: 'EUR', it: 'EUR', es: 'EUR', at: 'EUR', be: 'EUR', ch: 'CHF', se: 'SEK', dk: 'DKK' };

export default function DealsScreen() {
  const { products, loading, refreshing, error, reload, signals, ensureSignalsFor } = useProducts();
  const prefs = usePreferences();
  const { region, setRegion } = useRegion();
  const watchlist = useWatchlist();
  const b = (key: Parameters<typeof browseText>[1], params?: Record<string, string | number>) => browseText(prefs.language, key, params);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DealFilters>({ ...DEFAULT_DEAL_FILTERS });
  const [visibleLimit, setVisibleLimit] = useState(300);
  const [marketOpen, setMarketOpen] = useState(false);
  const [scanPending, setScanPending] = useState(false);
  const [scanAttempted, setScanAttempted] = useState(false);

  const regionProducts = useMemo(() => productsForRegion(products, region), [products, region]);
  const brands = useMemo(() => [...new Set(regionProducts.map((item) => item._brand))], [regionProducts]);
  const categories = useMemo(() => [...new Set(regionProducts.map(productCategory))], [regionProducts]);
  const platforms = useMemo(() => [...new Set(regionProducts.map((item) => item._platform))], [regionProducts]);
  const regionOptions = useMemo(() => availableDealRegions(products), [products]);
  const candidates = useMemo(() => filterDeals(products, region, query, { ...filters, lowOnly: false }, { targetCurrency: prefs.currency, rateSnapshot: prefs.rateSnapshot }), [filters, prefs.currency, prefs.rateSnapshot, products, query, region]);
  const checkedCount = useMemo(() => candidates.filter((item) => signals[item.sku_id]).length, [candidates, signals]);
  const coverageComplete = candidates.length === checkedCount;
  const filtered = useMemo(() => filterDeals(products, region, query, filters, { signals, targetCurrency: prefs.currency, rateSnapshot: prefs.rateSnapshot }), [filters, prefs.currency, prefs.rateSnapshot, products, query, region, signals]);

  useEffect(() => {
    if (!loading && products.length && region !== 'all' && !regionOptions.includes(region)) void setRegion('all');
  }, [loading, products.length, region, regionOptions, setRegion]);

  useEffect(() => {
    if (!filters.lowOnly || coverageComplete || scanPending || scanAttempted) return;
    setScanPending(true); setScanAttempted(true);
    void ensureSignalsFor(candidates).finally(() => setScanPending(false));
  }, [candidates, coverageComplete, ensureSignalsFor, filters.lowOnly, scanAttempted, scanPending]);

  useEffect(() => {
    if (!filters.lowOnly && candidates.length) void ensureSignalsFor(candidates.slice(0, 40));
  }, [candidates, ensureSignalsFor, filters.lowOnly]);

  useEffect(() => { setScanAttempted(false); }, [region, query, filters.brand, filters.platform, filters.category, filters.gender, filters.minDiscount]);

  const signalSummary = useMemo(() => {
    let lows = 0; let drops = 0;
    for (const item of candidates) { const signal = signals[item.sku_id]; if (signal?.kind === 'all_time_low') lows += 1; if (signal?.kind === 'drop_today') drops += 1; }
    return { lows, drops };
  }, [candidates, signals]);
  const latest = candidates.reduce((value, item) => item.last_updated && item.last_updated > value ? item.last_updated : value, '');
  const data = filtered.slice(0, visibleLimit);

  if (loading && !products.length) return <ScreenState title={prefs.t('deals.loading')} body={prefs.t('deals.loadingBody')} loading />;
  if (error && !products.length) return <ScreenState title={prefs.t('deals.loadError')} body={error} />;

  return <SafeAreaView style={styles.safe} edges={['top']}><FlatList data={data} numColumns={2} keyExtractor={(item) => item.sku_id} columnWrapperStyle={styles.columns} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setScanAttempted(false); void reload(); }} tintColor={colors.pill} />} ListHeaderComponent={<View style={styles.header}>
    <View style={styles.top}><BrandLogo style={styles.logo} /><MarketPill region={region} currency={prefs.currency} label={`${b('market')}: ${prefs.regionLabel(region)}`} onPress={() => setMarketOpen(true)} /></View>
    <View style={styles.search}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder={b('searchDeals')} placeholderTextColor={colors.muted} style={styles.searchInput} autoCapitalize="none" autoCorrect={false} />{query ? <Pressable style={styles.clear} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}</View>
    <FilterChips value={filters} brands={brands} platforms={platforms} categories={categories} resultCount={filtered.length} lowScanPending={scanPending || (Boolean(filters.lowOnly) && !coverageComplete && !scanAttempted)} onChange={(next) => { setVisibleLimit(300); setFilters((current) => ({ ...current, ...next })); }} />
    <Text style={styles.summary}>{b('summary', { market: prefs.regionLabel(region), count: prefs.formatNumber(filtered.length), when: freshnessLabel(latest) })}</Text>
    <View style={styles.signalRow}><Text style={styles.signalStrong}>{b('summarySignals', { lows: prefs.formatNumber(signalSummary.lows), drops: prefs.formatNumber(signalSummary.drops) })}</Text><Text style={styles.coverage}>{coverageComplete ? b('signalCoverage', { checked: checkedCount, total: candidates.length }) : scanAttempted && !scanPending ? b('signalUnavailable') : b('signalCoverage', { checked: checkedCount, total: candidates.length })}</Text></View>
  </View>} renderItem={({ item }) => <View style={styles.item}><DealCard product={item} signal={signals[item.sku_id]} saved={watchlist.isSaved(item.sku_id)} onPress={() => router.push({ pathname: '/product/[skuId]', params: { skuId: item.sku_id } })} onToggleSave={() => void toggleSave(watchlist, item, prefs.t)} /></View>} ListEmptyComponent={<ScreenState title={prefs.t('deals.noMatches')} body={filters.lowOnly && !coverageComplete ? b('loadingLows') : prefs.t('deals.noMatchesBody', { region: prefs.regionLabel(region) })} loading={scanPending} />} onEndReachedThreshold={0.4} onEndReached={() => setVisibleLimit((value) => Math.min(value + 300, filtered.length))} />
  <MarketSheet visible={marketOpen} title={b('market')} region={region} currency={prefs.currency} regions={regionOptions.map((value) => ({ value, label: prefs.regionLabel(value), currency: value === 'all' ? b('localCurrency') : REGION_CURRENCY[value] || '—' }))} currencies={([{ value: 'original', label: b('localCurrency') }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'CAD', label: 'CAD' }, { value: 'GBP', label: 'GBP' }] as Array<{ value: CurrencyPreference; label: string }>)} ratesNote={b('ratesNote')} catalogNote={b('catalogMarketNote')} applyLabel={b('apply')} onChangeRegion={(value) => { setQuery(''); setFilters((current) => ({ ...DEFAULT_DEAL_FILTERS, sort: current.sort })); void setRegion(value); }} onChangeCurrency={(value) => void prefs.setCurrency(value)} onClose={() => setMarketOpen(false)} />
  </SafeAreaView>;
}

async function toggleSave(watchlist: ReturnType<typeof useWatchlist>, product: Product, t: ReturnType<typeof usePreferences>['t']) { const saved = await watchlist.toggle(product); if (!saved) Alert.alert(t('deals.watchLimitTitle'), t('deals.watchLimitBody', { count: watchlist.freeLimit })); }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.screen }, content: { paddingHorizontal: 15, paddingBottom: 28 }, header: { gap: 10, paddingTop: 2, paddingBottom: 8 }, top: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, logo: { width: 122, height: 40 }, search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, paddingLeft: 12 }, searchInput: { minWidth: 0, flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 0 }, clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, summary: { color: colors.ink2, fontSize: 11.5, fontWeight: '700' }, signalRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 8, backgroundColor: colors.buyBg, paddingHorizontal: 9 }, signalStrong: { flexShrink: 1, color: colors.buy, fontSize: 10.5, fontWeight: '900' }, coverage: { flexShrink: 1, color: colors.ink2, fontSize: 9.5, textAlign: 'right' }, columns: { gap: 10 }, item: { minWidth: 0, flex: 1, maxWidth: '50%' } });
