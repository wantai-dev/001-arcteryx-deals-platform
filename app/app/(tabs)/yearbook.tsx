import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ControlRow } from '../../components/ControlRow';
import { DefaultImage } from '../../components/DefaultImage';
import { FilterSheet, type FilterSheetSection } from '../../components/FilterSheet';
import { MarketPill } from '../../components/MarketPill';
import { MarketSheet } from '../../components/MarketSheet';
import { ScreenState } from '../../components/ScreenState';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useProducts } from '../../contexts/ProductsContext';
import { useRegion } from '../../contexts/RegionContext';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { browseText } from '../../lib/browseI18n';
import { BRAND, PLATFORM, productCategory } from '../../lib/catalog';
import { convertAmount, type CurrencyPreference, type RateSnapshot } from '../../lib/currency';
import { availableDealRegions, productsForRegion } from '../../lib/deals';
import { fetchYearbookProducts } from '../../lib/supabase';
import { colors, radii, typography } from '../../lib/theme';
import type { CatalogBrandKey, CatalogGender, CatalogProduct, Product } from '../../lib/types';
import { bestYearbookOffers, brandLabel, filterYearbookArchive, filterYearbookProducts, groupYearbookArchive, indexYearbookDeals, yearbookBrands, yearbookCategories, yearbookYear, yearbookYears, type YearbookArchiveStyle } from '../../lib/yearbook';

type Scope = 'current' | 'archive';
type Sort = 'name' | 'price_asc' | 'price_desc' | 'newest';
type Filters = { brand: CatalogBrandKey | 'all'; gender: CatalogGender | 'all'; category: string; year: number | 'all' };
type Item = { kind: 'current'; value: CatalogProduct } | { kind: 'archive'; value: YearbookArchiveStyle };
const REGION_CURRENCY: Record<string, string> = { us: 'USD', ca: 'CAD', gb: 'GBP', au: 'AUD', de: 'EUR', fr: 'EUR', nl: 'EUR', fi: 'EUR', ie: 'EUR', it: 'EUR', es: 'EUR', at: 'EUR', be: 'EUR', ch: 'CHF', se: 'SEK', dk: 'DKK' };

export default function YearbookScreen() {
  const { products: allDeals } = useProducts();
  const prefs = usePreferences();
  const { region, setRegion } = useRegion();
  const watchlist = useWatchlist();
  const b = (key: Parameters<typeof browseText>[1], params?: Record<string, string | number>) => browseText(prefs.language, key, params);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true); const [unavailable, setUnavailable] = useState(false);
  const [scope, setScope] = useState<Scope>('current'); const [query, setQuery] = useState(''); const [sort, setSort] = useState<Sort>('name');
  const [filters, setFilters] = useState<Filters>({ brand: 'all', gender: 'all', category: 'all', year: 'all' });
  const [filtersOpen, setFiltersOpen] = useState(false); const [sortOpen, setSortOpen] = useState(false); const [marketOpen, setMarketOpen] = useState(false);

  const load = useCallback(async () => { setLoading(true); setUnavailable(false); try { setCatalog(await fetchYearbookProducts()); } catch { setUnavailable(true); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const deals = useMemo(() => productsForRegion(allDeals, region), [allDeals, region]);
  const dealIndex = useMemo(() => indexYearbookDeals(catalog, deals), [catalog, deals]);
  const archive = useMemo(() => groupYearbookArchive(dealIndex.unmatched), [dealIndex.unmatched]);
  const currentFiltered = useMemo(() => filterYearbookProducts(catalog, { query, ...filters }), [catalog, filters, query]);
  const archiveFiltered = useMemo(() => filterYearbookArchive(archive, { query, brand: filters.brand, gender: filters.gender, category: filters.category }), [archive, filters, query]);
  const items = useMemo<Item[]>(() => {
    if (scope === 'current') return sortCurrent(currentFiltered, sort, prefs.currency, prefs.rateSnapshot).map((value) => ({ kind: 'current', value }));
    return sortArchive(archiveFiltered, sort, prefs.currency, prefs.rateSnapshot).map((value) => ({ kind: 'archive', value }));
  }, [archiveFiltered, currentFiltered, prefs.currency, prefs.rateSnapshot, scope, sort]);
  const brands = scope === 'current' ? yearbookBrands(catalog) : [...new Set(archive.map((item) => item.brand_key))];
  const categories = scope === 'current' ? yearbookCategories(catalog) : [...new Set(archive.flatMap((item) => item.categories))].sort();
  const years = yearbookYears(catalog);
  const regionOptions = availableDealRegions(allDeals);
  const activeCount = Number(filters.brand !== 'all') + Number(filters.gender !== 'all') + Number(filters.category !== 'all') + Number(scope === 'current' && filters.year !== 'all');
  const sections: FilterSheetSection[] = [
    { key: 'brand', title: b('brand'), value: filters.brand, options: [{ value: 'all', label: b('allBrands') }, ...brands.map((value) => ({ value, label: brandLabel(value) }))] },
    { key: 'year', title: b('year'), value: String(filters.year), options: [{ value: 'all', label: b('allYears') }, ...years.map((value) => ({ value: String(value), label: String(value) }))] },
    { key: 'category', title: b('category'), value: filters.category, options: [{ value: 'all', label: b('allCategories') }, ...categories.map((value) => ({ value, label: prefs.categoryLabel(value) }))] },
    { key: 'gender', title: b('gender'), value: filters.gender, options: ['all', 'women', 'men', 'kids', 'unisex'].map((value) => ({ value, label: value === 'all' ? b('allGenders') : prefs.genderLabel(value) })) },
  ].filter((section) => scope === 'current' || section.key !== 'year');

  if (loading) return <ScreenState title={prefs.t('yearbook.loadingTitle')} body={prefs.t('yearbook.loadingBody')} loading />;
  if (unavailable) return <ScreenState title={prefs.t('yearbook.unavailableTitle')} body={prefs.t('yearbook.unavailableBody')} actionLabel={prefs.t('yearbook.retry')} onAction={() => void load()} />;
  if (!catalog.length) return <ScreenState title={prefs.t('yearbook.emptyTitle')} body={prefs.t('yearbook.emptyBody')} />;

  return <SafeAreaView style={styles.safe} edges={['top']}><FlatList data={items} numColumns={2} keyExtractor={(item) => item.kind === 'current' ? item.value.catalog_product_id : item.value.archive_id} columnWrapperStyle={styles.columns} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ListHeaderComponent={<View style={styles.header}>
    <View style={styles.top}><Text style={styles.title}>{prefs.t('tabs.yearbook')}</Text><MarketPill region={region} currency={prefs.currency} label={`${b('market')}: ${prefs.regionLabel(region)}`} onPress={() => setMarketOpen(true)} /></View>
    <View style={styles.segment}><Segment active={scope === 'current'} label={b('current', { count: catalog.length })} onPress={() => { setScope('current'); setFilters((value) => ({ ...value, year: 'all' })); }} /><Segment active={scope === 'archive'} label={b('archive', { count: archive.length })} onPress={() => { setScope('archive'); setFilters((value) => ({ ...value, year: 'all' })); }} /></View>
    <Text style={styles.help}>{scope === 'current' ? b('currentHelp') : b('archiveHelp')}</Text><Text style={styles.source}>{b('officialSource')}</Text>
    <View style={styles.search}><Ionicons name="search" size={18} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder={b('searchYearbook')} placeholderTextColor={colors.muted} style={styles.searchInput} autoCapitalize="none" autoCorrect={false} />{query ? <Pressable style={styles.clear} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}</View>
    <ControlRow sortLabel={`${b('sort')} · ${sortLabel(sort, prefs.language)}`} filterLabel={b('filters')} filterCount={activeCount} onSort={() => setSortOpen(true)} onFilter={() => setFiltersOpen(true)} />
  </View>} renderItem={({ item }) => <View style={styles.item}>{item.kind === 'current' ? <CurrentCard product={item.value} offers={dealIndex.byCatalogId[item.value.catalog_product_id] || []} saved={watchlist.isModelSaved(item.value)} onToggleSave={() => void watchlist.toggleModel(item.value).then((accepted) => { if (!accepted) Alert.alert(prefs.t('deals.watchLimitTitle'), prefs.t('deals.watchLimitBody', { count: watchlist.freeLimit })); })} /> : <ArchiveCard product={item.value} />}</View>} ListEmptyComponent={<ScreenState title={prefs.t('yearbook.noMatchesTitle')} body={prefs.t('yearbook.noMatchesBody')} />} />
  <FilterSheet visible={filtersOpen} title={b('filters')} sections={sections} resultLabel={b('viewResults', { count: items.length })} resetLabel={b('reset')} onSelect={(key, value) => setFilters((current) => ({ ...current, [key]: key === 'year' && value !== 'all' ? Number(value) : value }))} onReset={() => setFilters({ brand: 'all', gender: 'all', category: 'all', year: 'all' })} onClose={() => setFiltersOpen(false)} />
  <SortSheet visible={sortOpen} value={sort} language={prefs.language} onSelect={(value) => { setSort(value); setSortOpen(false); }} onClose={() => setSortOpen(false)} />
  <MarketSheet visible={marketOpen} title={b('market')} region={region} currency={prefs.currency} regions={regionOptions.map((value) => ({ value, label: prefs.regionLabel(value), currency: value === 'all' ? b('localCurrency') : REGION_CURRENCY[value] || '—' }))} currencies={([{ value: 'original', label: b('localCurrency') }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'CAD', label: 'CAD' }, { value: 'GBP', label: 'GBP' }] as Array<{ value: CurrencyPreference; label: string }>)} ratesNote={b('ratesNote')} catalogNote={b('catalogMarketNote')} applyLabel={b('apply')} onChangeRegion={(value) => void setRegion(value)} onChangeCurrency={(value) => void prefs.setCurrency(value)} onClose={() => setMarketOpen(false)} />
  </SafeAreaView>;
}

function CurrentCard({ product, offers, saved, onToggleSave }: { product: CatalogProduct; offers: Product[]; saved: boolean; onToggleSave: () => void }) {
  const prefs = usePreferences(); const b = (key: Parameters<typeof browseText>[1]) => browseText(prefs.language, key); const best = bestYearbookOffers(offers, prefs.currency === 'original' ? undefined : prefs.currency)[0];
  const open = () => best ? router.push({ pathname: '/product/[skuId]', params: { skuId: best.sku_id } }) : void Linking.openURL(product.source_url);
  return <Pressable style={styles.card} onPress={open}><View style={styles.photo}><DefaultImage category={product.categories.join(' ')} brand={product.brand} /><Status tone={best ? 'sale' : 'list'} text={best ? b('onSale') : b('listPrice')} /><Pressable accessibilityRole="button" accessibilityLabel={b('modelWatch')} style={{ position: 'absolute', top: 3, right: 3, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.onPhotoBadge }} onPress={(event) => { event.stopPropagation(); onToggleSave(); }}><Ionicons name={saved ? 'heart' : 'heart-outline'} size={17} color={saved ? colors.disc : colors.ink} /></Pressable></View><Text style={styles.brandMeta}>{product.brand} · {prefs.categoryLabel(product.categories[0] || 'other')}</Text><Text style={styles.name} numberOfLines={2}>{product.name}</Text><Text style={styles.price}>{best ? prefs.formatMoney(best.sale_price, best.currency, best.symbol) : formatRange(product, prefs)}</Text><Text style={styles.marketMeta}>{product.country.toUpperCase()} · {best ? PLATFORM[best._platform]?.label || best._platform : product.currency}</Text></Pressable>;
}

function ArchiveCard({ product }: { product: YearbookArchiveStyle }) {
  const prefs = usePreferences(); const b = (key: Parameters<typeof browseText>[1]) => browseText(prefs.language, key); const best = bestYearbookOffers(product.offers, prefs.currency === 'original' ? undefined : prefs.currency)[0];
  if (!best) return null;
  return <Pressable style={styles.card} onPress={() => router.push({ pathname: '/product/[skuId]', params: { skuId: best.sku_id } })}><View style={styles.photo}><DefaultImage category={product.categories.join(' ')} brand={BRAND[product.brand_key].label} /><Status tone="archive" text={b('archiveFrom')} /></View><Text style={styles.brandMeta}>{BRAND[product.brand_key].label} · {prefs.categoryLabel(product.categories[0] || productCategory(best))}</Text><Text style={styles.name} numberOfLines={2}>{product.name}</Text><Text style={styles.price}>{prefs.formatMoney(best.sale_price, best.currency, best.symbol)}</Text><Text style={styles.marketMeta}>{best.currency} · {PLATFORM[best._platform]?.label || best._platform}</Text></Pressable>;
}

function Status({ tone, text }: { tone: 'sale' | 'list' | 'archive'; text: string }) { return <View style={[styles.status, tone === 'sale' ? styles.statusSale : tone === 'archive' ? styles.statusArchive : styles.statusList]}><Text style={[styles.statusText, tone === 'sale' ? styles.statusSaleText : tone === 'archive' ? styles.statusArchiveText : styles.statusListText]} numberOfLines={1}>{text}</Text></View>; }
function Segment({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) { return <Pressable style={[styles.segmentButton, active && styles.segmentActive]} onPress={onPress}><Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>{label}</Text></Pressable>; }
function formatRange(product: CatalogProduct, prefs: ReturnType<typeof usePreferences>) { const min = prefs.formatMoney(product.list_price, product.currency); const max = prefs.formatMoney(product.list_price_max, product.currency); return product.list_price_max > product.list_price ? `${min}–${max}` : min; }
function sortablePrice(value: number, source: string, target: CurrencyPreference, snapshot: RateSnapshot | null) { const comparison = target === 'original' ? 'EUR' : target; const result = convertAmount(value, source, comparison, snapshot); return result.currency === comparison ? result.value : null; }
function comparePrice(left: number | null, right: number | null, direction: 1 | -1) { if (left !== null && right !== null) return direction * (left - right); if (left !== null) return -1; if (right !== null) return 1; return 0; }
function sortCurrent(rows: CatalogProduct[], sort: Sort, currency: CurrencyPreference, snapshot: RateSnapshot | null) { return [...rows].sort((a, b) => sort === 'price_asc' ? comparePrice(sortablePrice(a.list_price, a.currency, currency, snapshot), sortablePrice(b.list_price, b.currency, currency, snapshot), 1) || a.currency.localeCompare(b.currency) : sort === 'price_desc' ? comparePrice(sortablePrice(a.list_price, a.currency, currency, snapshot), sortablePrice(b.list_price, b.currency, currency, snapshot), -1) || a.currency.localeCompare(b.currency) : sort === 'newest' ? yearbookYear(b) - yearbookYear(a) : a.name.localeCompare(b.name)); }
function sortArchive(rows: YearbookArchiveStyle[], sort: Sort, currency: CurrencyPreference, snapshot: RateSnapshot | null) { return [...rows].sort((a, b) => { const ao = bestYearbookOffers(a.offers)[0]; const bo = bestYearbookOffers(b.offers)[0]; const ap = ao ? sortablePrice(ao.sale_price, ao.currency, currency, snapshot) : null; const bp = bo ? sortablePrice(bo.sale_price, bo.currency, currency, snapshot) : null; return sort === 'price_asc' ? comparePrice(ap, bp, 1) || a.name.localeCompare(b.name) : sort === 'price_desc' ? comparePrice(ap, bp, -1) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name); }); }
function sortLabel(sort: Sort, language: Parameters<typeof browseText>[0]) { const labels = { en: { name: 'Name', price_asc: 'Lowest price', price_desc: 'Highest price', newest: 'Newest' }, 'zh-Hans': { name: '名称', price_asc: '价格从低到高', price_desc: '价格从高到低', newest: '最新年份' }, de: { name: 'Name', price_asc: 'Niedrigster Preis', price_desc: 'Höchster Preis', newest: 'Neueste zuerst' }, fr: { name: 'Nom', price_asc: 'Prix croissant', price_desc: 'Prix décroissant', newest: 'Plus récents' }, ja: { name: '名前', price_asc: '価格の安い順', price_desc: '価格の高い順', newest: '新しい順' } }; return labels[language][sort]; }
function SortSheet({ visible, value, language, onSelect, onClose }: { visible: boolean; value: Sort; language: Parameters<typeof browseText>[0]; onSelect: (value: Sort) => void; onClose: () => void }) { return <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={onClose}><View style={styles.backdrop}><View style={styles.sortSheet}>{(['name', 'price_asc', 'price_desc', 'newest'] as Sort[]).map((option) => <Pressable key={option} style={styles.sortOption} onPress={() => onSelect(option)}><Text style={styles.sortOptionText}>{sortLabel(option, language)}</Text>{option === value ? <Ionicons name="checkmark" size={18} color={colors.buy} /> : null}</Pressable>)}</View></View></Modal>; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.screen }, content: { paddingHorizontal: 15, paddingBottom: 28 }, header: { gap: 9, paddingTop: 2, paddingBottom: 10 }, top: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.ink, fontSize: 24, fontWeight: '900' }, segment: { height: 44, flexDirection: 'row', borderRadius: 11, backgroundColor: colors.card, padding: 3 }, segmentButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, segmentActive: { backgroundColor: colors.pill }, segmentText: { color: colors.muted, fontSize: 12, fontWeight: '800' }, segmentTextActive: { color: colors.onPill }, help: { color: colors.ink2, fontSize: 12, lineHeight: 17 }, source: { color: colors.muted, fontSize: 10.5, lineHeight: 15 }, search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, paddingLeft: 12 }, searchInput: { minWidth: 0, flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 0 }, clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, columns: { gap: 10 }, item: { minWidth: 0, flex: 1, maxWidth: '50%' }, card: { flex: 1, gap: 4, paddingBottom: 14 }, photo: { width: '100%', aspectRatio: 4 / 5, overflow: 'hidden', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.photo }, status: { position: 'absolute', top: 7, left: 7, maxWidth: '84%', borderRadius: radii.sm, paddingHorizontal: 7, paddingVertical: 4 }, statusSale: { backgroundColor: colors.buyBg }, statusArchive: { backgroundColor: colors.discBg }, statusList: { backgroundColor: colors.onPhotoBadge }, statusText: { fontSize: 9.5, fontWeight: '900' }, statusSaleText: { color: colors.buy }, statusArchiveText: { color: colors.disc }, statusListText: { color: colors.ink2 }, brandMeta: { color: colors.muted, fontSize: 10.5, fontWeight: '700' }, name: { minHeight: 34, color: colors.ink, fontSize: 13.5, lineHeight: 17, fontWeight: '800' }, price: { color: colors.disc, fontFamily: typography.mono, fontVariant: typography.tabular, fontSize: 14.5, fontWeight: '900' }, marketMeta: { color: colors.muted, fontSize: 10.5 }, backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,9,10,.42)' }, sortSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.card, padding: 18, paddingBottom: 30 }, sortOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, sortOptionText: { color: colors.ink, fontSize: 14, fontWeight: '800' } });
