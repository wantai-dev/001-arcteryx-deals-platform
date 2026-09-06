import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertModal } from '../../components/AlertModal';
import { PriceChart } from '../../components/PriceChart';
import { ProGate } from '../../components/ProGate';
import { ScreenState } from '../../components/ScreenState';
import { TopoPlaceholder } from '../../components/TopoPlaceholder';
import { useProducts } from '../../contexts/ProductsContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { usePro } from '../../contexts/ProContext';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { useTheme } from '../../contexts/ThemeContext';
import { BRAND, productCategory, productName, releaseSeason } from '../../lib/catalog';
import { openBuyUrl, softImpact } from '../../lib/actions';
import { convertAmount } from '../../lib/currency';
import { buildPriceAlertRequest } from '../../lib/priceAlerts';
import { computeSignal, historyToPoints, recentPoints } from '../../lib/signals';
import { fetchPriceHistory, fetchProductFamilyBySku, insertPriceAlert } from '../../lib/supabase';
import { radii, typography, type ThemeColors } from '../../lib/theme';
import type { PriceHistoryRow, Product } from '../../lib/types';
import type { AlertDraft } from '../../lib/watchlist';

export default function ProductDetailScreen() {
  const { skuId } = useLocalSearchParams<{ skuId: string }>();
  const { getProduct, cheaperAlternatives } = useProducts();
  const { categoryLabel, formatMoney, genderLabel, rateSnapshot, regionLabel, t } = usePreferences();
  const watchlist = useWatchlist();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isPro } = usePro();
  const [fallbackFamily, setFallbackFamily] = useState<Product[]>([]);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const { width } = useWindowDimensions();
  const contextProduct = getProduct(skuId);
  const product = contextProduct || fallbackFamily.find((row) => row.sku_id === skuId) || fallbackFamily[0];

  useEffect(() => {
    if (!skuId || contextProduct) return;
    let active = true;
    setFallbackFamily([]);
    setLoadingProduct(true);
    fetchProductFamilyBySku(skuId)
      .then((rows) => { if (active) setFallbackFamily(rows); })
      .catch(() => { if (active) setFallbackFamily([]); })
      .finally(() => { if (active) setLoadingProduct(false); });
    return () => { active = false; };
  }, [contextProduct, skuId]);

  useEffect(() => {
    let active = true;
    setHistory([]);
    if (!product?.sku_id) return () => { active = false; };
    setLoadingHistory(true);
    fetchPriceHistory(product.sku_id)
      .then((rows) => { if (active) setHistory(rows); })
      .catch(() => { if (active) setHistory([]); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, [product?.sku_id]);

  useEffect(() => {
    setFailedImages({});
  }, [product?.sku_id]);

  const points = useMemo(() => (product ? historyToPoints(history, product) : []), [history, product]);
  const chartPoints = useMemo(() => (isPro ? points : recentPoints(points, 30)), [isPro, points]);
  const signal = useMemo(() => (product ? computeSignal(product, history) : null), [history, product]);
  const alternatives = product ? cheaperAlternatives(product) : [];
  const saved = product ? watchlist.isSaved(product.sku_id) : false;
  const verdictText = signal?.kind === 'all_time_low' ? t('signal.all_time_low')
    : signal?.kind === 'ninety_day_low' ? t('signal.ninety_day_low')
      : signal?.kind === 'drop_today' ? signal.label
        : signal?.kind === 'steady' ? t('signal.steady') : '';

  if (!product && loadingProduct) {
    return <ScreenState title={t('product.loading')} body={t('product.loadingBody')} loading />;
  }

  if (!product) {
    return <ScreenState title={t('product.notFound')} body={t('product.notFoundBody')} />;
  }

  const currentProduct = product;
  const name = productName(currentProduct);
  const imageCandidates = Array.from(new Set([currentProduct.image_url, ...currentProduct.images].filter(Boolean))) as string[];
  const visibleImages = imageCandidates.filter((uri) => !failedImages[uri]);
  const galleryImages = visibleImages.length ? visibleImages : ['__placeholder__'];
  const season = releaseSeason(currentProduct);
  const galleryWidth = Math.max(width - 30, 1);
  const currentCategory = categoryLabel(productCategory(currentProduct));

  async function submitAlert(draft: AlertDraft, scope: 'sku' | 'model') {
    const accepted = await watchlist.saveAlertForSource(currentProduct, scope, draft);
    if (!accepted) return false;
    if (draft.email && scope === 'sku') {
      const converted = convertAmount(draft.targetAmount, draft.targetCurrency, currentProduct.currency as never, rateSnapshot);
      if (draft.targetCurrency !== currentProduct.currency && !converted.converted) throw new Error('Current exchange rates are unavailable for email alerts.');
      try {
        await insertPriceAlert(buildPriceAlertRequest(currentProduct, draft.email, converted.value));
      } catch (error) {
        await watchlist.saveAlertForSource(currentProduct, 'sku', { ...draft, email: undefined });
        throw error;
      }
    }
    return true;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.nav}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={async () => {
              const savedNow = await watchlist.toggle(currentProduct);
              if (!savedNow) {
                Alert.alert(t('deals.watchLimitTitle'), t('deals.watchLimitBody', { count: watchlist.freeLimit }));
              }
            }}
          >
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={23} color={saved ? colors.danger : colors.ink} />
          </Pressable>
        </View>

        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gallery}>
          {galleryImages.map((uri, index) => (
            <View style={[styles.imageFrame, { width: galleryWidth }]} key={uri}>
              <TopoPlaceholder label={currentCategory} showLabel={false} />
              {uri !== '__placeholder__' && !failedImages[uri] ? (
                <Image source={{ uri }} contentFit="cover" transition={180} style={styles.image} onError={() => setFailedImages((current) => ({ ...current, [uri]: true }))} />
              ) : null}
              <View style={styles.imageDiscount}>
                <Text style={styles.imageDiscountText}>-{currentProduct.discount_pct}%</Text>
              </View>
              {visibleImages.length > 1 ? (
                <View style={styles.imageDots}>
                  {visibleImages.slice(0, 4).map((dot, dotIndex) => (
                    <View key={dot} style={[styles.imageDot, dotIndex === index && styles.imageDotActive]} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={styles.block}>
          <Text style={styles.category}>{BRAND[currentProduct._brand].label} · {currentCategory}</Text>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.meta}>{[currentProduct.color, genderLabel(currentProduct.gender || 'unknown'), regionLabel(currentProduct.region), season].filter(Boolean).join(' · ')}</Text>
        </View>

        <View style={styles.priceBlock}>
          <Text style={styles.sale}>{formatMoney(currentProduct.sale_price, currentProduct.currency, currentProduct.symbol)}</Text>
          {currentProduct.original_price > currentProduct.sale_price ? <Text style={styles.original}>{formatMoney(currentProduct.original_price, currentProduct.currency, currentProduct.symbol)}</Text> : null}
          <View style={styles.discount}>
            <Text style={styles.discountText}>-{currentProduct.discount_pct}%</Text>
          </View>
          {isPro && signal?.kind === 'all_time_low' ? (
            <View style={styles.lowBadge}>
              <Text style={styles.lowBadgeText}>{t('signal.all_time_low')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('product.priceHistory')}</Text>
            {loadingHistory ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.sectionMeta}>{isPro ? t('product.fullHistory') : t('product.last30Days')}</Text>}
          </View>
          <View style={styles.chartWrap}>
            <PriceChart points={chartPoints} product={currentProduct} />
          </View>
          {!isPro ? <ProGate title={t('product.upgradeHistory')} subtitle={t('product.upgradeHistorySub')} action={t('product.viewPro')} /> : null}
        </View>

        {signal && signal.kind !== 'insufficient' ? (
          <View style={[styles.verdict, signal.isLow ? styles.verdictGood : styles.verdictNeutral]}>
            <Ionicons name={signal.isLow ? 'checkmark' : 'time-outline'} size={15} color={signal.isLow ? colors.buy : colors.muted} />
            <Text style={[styles.verdictText, signal.isLow && styles.verdictGoodText]}>{verdictText}</Text>
          </View>
        ) : null}

        <View style={styles.regionLine}>
          <Text style={styles.regionLead}>{t('product.alsoCheaper')}</Text>
          {alternatives.length ? (
            <View style={styles.alternatives}>
              {alternatives.map((item) => (
                <Pressable key={item.sku_id} style={styles.altPill} onPress={() => router.push({ pathname: '/product/[skuId]', params: { skuId: item.sku_id } })}>
                  <Text style={styles.altText}>{regionLabel(item.region)} {formatMoney(item.sale_price, item.currency, item.symbol)}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>{t('product.noCheaper')}</Text>
          )}
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, styles.alertButton]}
            onPress={async () => {
              await softImpact();
              setAlertOpen(true);
            }}
          >
            <Ionicons name="notifications-outline" size={18} color={colors.ink} />
            <Text style={styles.alertText}>{t('product.alert')}</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.buyButton]} onPress={() => openBuyUrl(currentProduct.url)}>
            <Text style={styles.buyText}>{t('product.buy')}</Text>
            <Ionicons name="open-outline" size={18} color={colors.onPill} />
          </Pressable>
        </View>
      </ScrollView>
      <AlertModal visible={alertOpen} source={currentProduct} entry={watchlist.getEntry(currentProduct.sku_id)} historicalLow={signal?.minPrice} onClose={() => setAlertOpen(false)} onSubmit={submitAlert} />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingBottom: 34,
  },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  gallery: {
    marginHorizontal: 15,
  },
  imageFrame: {
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.photo,
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  imageDiscount: {
    position: 'absolute',
    left: 12,
    top: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.discLine,
    backgroundColor: colors.onPhotoBadge,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  imageDiscountText: {
    color: colors.onPhotoDisc,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontSize: 11,
    fontWeight: '900',
  },
  imageDots: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    gap: 4,
  },
  imageDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.photoDot,
    opacity: 0.35,
  },
  imageDotActive: {
    backgroundColor: colors.photoDot,
    opacity: 0.9,
  },
  block: {
    gap: 5,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 0,
  },
  category: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: 0,
  },
  meta: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  priceBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
    marginHorizontal: 20,
    marginTop: 11,
  },
  sale: {
    color: colors.disc,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  original: {
    color: colors.faint,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontSize: 16,
    fontWeight: '700',
    textDecorationLine: 'line-through',
  },
  discount: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.discLine,
    backgroundColor: colors.discBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  discountText: {
    color: colors.disc,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontWeight: '900',
  },
  lowBadge: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.buyLine,
    backgroundColor: colors.buyBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  lowBadgeText: {
    color: colors.buy,
    fontWeight: '900',
  },
  section: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  sectionMeta: {
    color: colors.muted,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontSize: 12,
    fontWeight: '800',
  },
  chartWrap: {
    overflow: 'hidden',
    borderRadius: radii.md,
  },
  paywallOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 18,
    backgroundColor: colors.overlay,
  },
  paywallTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  paywallSub: {
    color: colors.muted,
    fontWeight: '700',
    textAlign: 'center',
  },
  paywallButton: {
    marginTop: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  paywallButtonText: {
    color: colors.onPill,
    fontWeight: '900',
  },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  verdictGood: {
    borderColor: colors.buyLine,
    backgroundColor: colors.buyBg,
  },
  verdictNeutral: {
    borderColor: colors.border,
    backgroundColor: colors.screen,
  },
  verdictText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12.5,
    fontWeight: '900',
  },
  verdictGoodText: {
    color: colors.buy,
  },
  regionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  regionLead: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  alternatives: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  altPill: {
    paddingVertical: 2,
  },
  altText: {
    color: colors.ink,
    fontFamily: typography.mono,
    fontVariant: typography.tabular,
    fontSize: 12,
    fontWeight: '900',
  },
  muted: {
    color: colors.muted,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  alertButton: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buyButton: {
    backgroundColor: colors.pill,
  },
  alertText: {
    color: colors.ink,
    fontWeight: '900',
  },
  buyText: {
    color: colors.onPill,
    fontWeight: '900',
  },
}); }
