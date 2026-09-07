import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "../../components/BrandLogo";
import { DealCard } from "../../components/DealCard";
import { FilterChips } from "../../components/FilterChips";
import { MarketPill } from "../../components/MarketPill";
import { MarketSheet } from "../../components/MarketSheet";
import { ScreenState } from "../../components/ScreenState";
import { SearchField } from "../../components/SearchField";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useProducts } from "../../contexts/ProductsContext";
import { useMarket } from "../../contexts/MarketContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useWatchlist } from "../../contexts/WatchlistContext";
import { browseText } from "../../lib/browseI18n";
import { productCategory } from "../../lib/catalog";
import {
  availableDealRegions,
  DEAL_PAGE_SIZE,
  DEFAULT_DEAL_FILTERS,
  filterDeals,
  nextDealVisibleLimit,
  productsForRegion,
  type DealFilters,
} from "../../lib/deals";
import {
  marketCurrencyOptions,
  marketRegionOptions,
} from "../../lib/marketOptions";
import type { ThemeColors } from "../../lib/theme";
import type { Product } from "../../lib/types";
import { yearbookFreshnessLabel } from "../../lib/yearbook";

export default function DealsScreen() {
  const {
    products,
    loading,
    refreshing,
    error,
    reload,
    signals,
    ensureSignalsFor,
  } = useProducts();
  const prefs = usePreferences();
  const { region, currency, setMarket } = useMarket();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const watchlist = useWatchlist();
  const b = (
    key: Parameters<typeof browseText>[1],
    params?: Record<string, string | number>,
  ) => browseText(prefs.language, key, params);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<DealFilters>({
    ...DEFAULT_DEAL_FILTERS,
  });
  const [visibleLimit, setVisibleLimit] = useState(DEAL_PAGE_SIZE);
  const [marketOpen, setMarketOpen] = useState(false);
  const [scanPending, setScanPending] = useState(false);
  const [scanAttempted, setScanAttempted] = useState(false);

  const regionProducts = useMemo(
    () => productsForRegion(products, region),
    [products, region],
  );
  const brands = useMemo(
    () => [...new Set(regionProducts.map((item) => item._brand))],
    [regionProducts],
  );
  const categories = useMemo(
    () => [...new Set(regionProducts.map(productCategory))],
    [regionProducts],
  );
  const platforms = useMemo(
    () => [...new Set(regionProducts.map((item) => item._platform))],
    [regionProducts],
  );
  const regionOptions = useMemo(
    () => availableDealRegions(products),
    [products],
  );
  const candidates = useMemo(
    () =>
      filterDeals(
        products,
        region,
        query,
        { ...filters, lowOnly: false },
        { targetCurrency: currency, rateSnapshot: prefs.rateSnapshot },
      ),
    [currency, filters, prefs.rateSnapshot, products, query, region],
  );
  const checkedCount = useMemo(
    () => candidates.filter((item) => signals[item.sku_id]).length,
    [candidates, signals],
  );
  const coverageComplete = candidates.length === checkedCount;
  const filtered = useMemo(
    () =>
      filterDeals(products, region, query, filters, {
        signals,
        targetCurrency: currency,
        rateSnapshot: prefs.rateSnapshot,
      }),
    [currency, filters, prefs.rateSnapshot, products, query, region, signals],
  );

  useEffect(() => {
    if (
      !loading &&
      products.length &&
      region !== "all" &&
      !regionOptions.includes(region)
    )
      void setMarket({ region: "all", currency });
  }, [currency, loading, products.length, region, regionOptions, setMarket]);

  useEffect(() => {
    if (!filters.lowOnly || coverageComplete || scanPending || scanAttempted)
      return;
    setScanPending(true);
    setScanAttempted(true);
    void ensureSignalsFor(candidates).finally(() => setScanPending(false));
  }, [
    candidates,
    coverageComplete,
    ensureSignalsFor,
    filters.lowOnly,
    scanAttempted,
    scanPending,
  ]);

  useEffect(() => {
    if (!filters.lowOnly && candidates.length)
      void ensureSignalsFor(candidates.slice(0, 40));
  }, [candidates, ensureSignalsFor, filters.lowOnly]);

  useEffect(() => {
    setScanAttempted(false);
  }, [
    region,
    query,
    filters.brand,
    filters.platform,
    filters.category,
    filters.gender,
    filters.minDiscount,
  ]);

  const signalSummary = useMemo(() => {
    let lows = 0;
    let drops = 0;
    for (const item of candidates) {
      const signal = signals[item.sku_id];
      if (signal?.kind === "all_time_low") lows += 1;
      if (signal?.kind === "drop_today") drops += 1;
    }
    return { lows, drops };
  }, [candidates, signals]);
  const latest = candidates.reduce(
    (value, item) =>
      item.last_updated && item.last_updated > value
        ? item.last_updated
        : value,
    "",
  );
  const data = filtered.slice(0, visibleLimit);

  if (loading && !products.length)
    return (
      <ScreenState
        title={prefs.t("deals.loading")}
        body={prefs.t("deals.loadingBody")}
        loading
      />
    );
  if (error && !products.length)
    return <ScreenState title={prefs.t("deals.loadError")} body={error} />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={data}
        numColumns={2}
        keyExtractor={(item) => item.sku_id}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setScanAttempted(false);
              void reload();
            }}
            tintColor={colors.pill}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.top}>
              <View style={styles.logoPlate}>
                {prefs.language === "zh-Hans" ? (
                  <Text style={styles.zhLogo}>
                    值<Text style={styles.zhLogoAccent}>de</Text>
                  </Text>
                ) : (
                  <BrandLogo style={styles.logo} />
                )}
              </View>
              <MarketPill
                region={region}
                currency={currency}
                label={`${b("market")}: ${prefs.regionLabel(region)}`}
                onPress={() => setMarketOpen(true)}
              />
            </View>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={b("searchDeals")}
              clearAccessibilityLabel={b("clearSearch")}
            />
            <FilterChips
              value={filters}
              brands={brands}
              platforms={platforms}
              categories={categories}
              resultCount={filtered.length}
              lowScanPending={
                scanPending ||
                (Boolean(filters.lowOnly) &&
                  !coverageComplete &&
                  !scanAttempted)
              }
              onChange={(next) => {
                setVisibleLimit(DEAL_PAGE_SIZE);
                setFilters((current) => ({ ...current, ...next }));
              }}
            />
            <Text style={styles.summary}>
              {b("summary", {
                market: prefs.regionLabel(region),
                count: prefs.formatNumber(filtered.length),
                when: yearbookFreshnessLabel(latest, prefs.language),
              })}
              {"  "}
              <Text style={styles.signalStrong}>
                {b("summarySignals", {
                  lows: prefs.formatNumber(signalSummary.lows),
                  drops: prefs.formatNumber(signalSummary.drops),
                })}
              </Text>
              {"  "}
              <Text style={styles.coverage}>
                {coverageComplete
                  ? b("signalCoverage", {
                      checked: checkedCount,
                      total: candidates.length,
                    })
                  : scanAttempted && !scanPending
                    ? b("signalUnavailable")
                    : b("signalCoverage", {
                        checked: checkedCount,
                        total: candidates.length,
                      })}
              </Text>
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            <DealCard
              product={item}
              signal={signals[item.sku_id]}
              saved={watchlist.isSaved(item.sku_id)}
              onPress={() =>
                router.push({
                  pathname: "/product/[skuId]",
                  params: { skuId: item.sku_id },
                })
              }
              onToggleSave={() => void toggleSave(watchlist, item, prefs.t)}
            />
          </View>
        )}
        ListEmptyComponent={
          <ScreenState
            title={prefs.t("deals.noMatches")}
            body={
              filters.lowOnly && !coverageComplete
                ? b("loadingLows")
                : prefs.t("deals.noMatchesBody", {
                    region: prefs.regionLabel(region),
                  })
            }
            loading={scanPending}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() =>
          setVisibleLimit((value) =>
            nextDealVisibleLimit(value, filtered.length),
          )
        }
      />
      <MarketSheet
        visible={marketOpen}
        title={b("market")}
        region={region}
        currency={currency}
        regions={marketRegionOptions(
          regionOptions,
          (value) => prefs.regionLabel(value),
          b("localCurrency"),
        )}
        currencies={marketCurrencyOptions(currency, b("localCurrency"))}
        ratesNote={b("ratesNote")}
        catalogNote={b("catalogMarketNote")}
        applyLabel={b("apply")}
        closeLabel={b("close")}
        errorLabel={b("marketSaveError")}
        onApply={async (nextRegion, nextCurrency) => {
          await setMarket({ region: nextRegion, currency: nextCurrency });
          setQuery("");
          setFilters((current) => ({
            ...DEFAULT_DEAL_FILTERS,
            sort: current.sort,
          }));
        }}
        onClose={() => setMarketOpen(false)}
      />
    </SafeAreaView>
  );
}

async function toggleSave(
  watchlist: ReturnType<typeof useWatchlist>,
  product: Product,
  t: ReturnType<typeof usePreferences>["t"],
) {
  const saved = await watchlist.toggle(product);
  if (!saved)
    Alert.alert(
      t("deals.watchLimitTitle"),
      t("deals.watchLimitBody", { count: watchlist.freeLimit }),
    );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.screen },
    content: { paddingHorizontal: 15, paddingBottom: 28 },
    header: { gap: 10, paddingTop: 2, paddingBottom: 8 },
    top: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    logoPlate: {
      minWidth: 122,
      height: 40,
      alignItems: "flex-start",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: "#F4F1E9",
      paddingHorizontal: 7,
    },
    logo: { width: 108, height: 34 },
    zhLogo: {
      color: "#202326",
      fontSize: 25,
      fontWeight: "900",
      letterSpacing: -1,
    },
    zhLogoAccent: {
      color: "#B73535",
      fontFamily: "monospace",
      fontSize: 16,
      fontWeight: "900",
      letterSpacing: 0,
    },
    summary: {
      color: colors.ink2,
      fontSize: 11.5,
      lineHeight: 17,
      fontWeight: "700",
    },
    signalStrong: { color: colors.buy, fontWeight: "900" },
    coverage: { color: colors.muted, fontSize: 10.5 },
    columns: { gap: 10 },
    item: { minWidth: 0, flex: 1, maxWidth: "50%" },
  });
