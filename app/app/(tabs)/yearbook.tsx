import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ControlRow } from "../../components/ControlRow";
import { ActiveChips, type ActiveChip } from "../../components/ActiveChips";
import { AlertModal } from "../../components/AlertModal";
import { DefaultImage } from "../../components/DefaultImage";
import {
  FilterSheet,
  type FilterSheetSection,
} from "../../components/FilterSheet";
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
import { BRAND, PLATFORM, productCategory } from "../../lib/catalog";
import {
  convertAmount,
  type CurrencyPreference,
  type RateSnapshot,
} from "../../lib/currency";
import { availableDealRegions, productsForRegion } from "../../lib/deals";
import { fetchYearbookProducts } from "../../lib/supabase";
import { radii, typography, type ThemeColors } from "../../lib/theme";
import type {
  CatalogBrandKey,
  CatalogGender,
  CatalogProduct,
  Product,
} from "../../lib/types";
import {
  bestYearbookOffers,
  brandLabel,
  comparableYearbookOffer,
  filterYearbookArchive,
  filterYearbookProducts,
  groupYearbookArchive,
  indexYearbookDeals,
  yearbookBrands,
  yearbookCategories,
  yearbookYear,
  yearbookYears,
  type YearbookArchiveStyle,
} from "../../lib/yearbook";

type Scope = "current" | "archive";
type Sort = "name" | "price_asc" | "price_desc" | "newest";
type Filters = {
  brand: CatalogBrandKey | "all";
  gender: CatalogGender | "all";
  category: string;
  year: number | "all";
};
type Item =
  | { kind: "current"; value: CatalogProduct }
  | { kind: "archive"; value: YearbookArchiveStyle };
const REGION_CURRENCY: Record<string, string> = {
  us: "USD",
  ca: "CAD",
  gb: "GBP",
  au: "AUD",
  de: "EUR",
  fr: "EUR",
  nl: "EUR",
  fi: "EUR",
  ie: "EUR",
  it: "EUR",
  es: "EUR",
  at: "EUR",
  be: "EUR",
  ch: "CHF",
  se: "SEK",
  dk: "DKK",
};

export default function YearbookScreen() {
  const { products: allDeals } = useProducts();
  const prefs = usePreferences();
  const { region, currency, setMarket } = useMarket();
  const { colors, styles } = useBrowseStyles();
  const watchlist = useWatchlist();
  const b = (
    key: Parameters<typeof browseText>[1],
    params?: Record<string, string | number>,
  ) => browseText(prefs.language, key, params);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [scope, setScope] = useState<Scope>("current");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [filters, setFilters] = useState<Filters>({
    brand: "all",
    gender: "all",
    category: "all",
    year: "all",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(
    null,
  );
  const [alertProduct, setAlertProduct] = useState<CatalogProduct | null>(null);

  async function toggleModelWithFeedback(
    product: CatalogProduct,
    offers: Product[],
  ) {
    try {
      const accepted = await watchlist.toggleModel(product, offers);
      if (!accepted) {
        Alert.alert(
          prefs.t("deals.watchLimitTitle"),
          prefs.t("deals.watchLimitBody", { count: watchlist.freeLimit }),
        );
      }
    } catch {
      Alert.alert(b("watchSaveErrorTitle"), b("watchSaveErrorBody"));
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      setCatalog(await fetchYearbookProducts());
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const deals = useMemo(
    () => productsForRegion(allDeals, region),
    [allDeals, region],
  );
  const dealIndex = useMemo(
    () => indexYearbookDeals(catalog, deals),
    [catalog, deals],
  );
  const archive = useMemo(
    () => groupYearbookArchive(dealIndex.unmatched),
    [dealIndex.unmatched],
  );
  const currentFiltered = useMemo(
    () => filterYearbookProducts(catalog, { query, ...filters }),
    [catalog, filters, query],
  );
  const archiveFiltered = useMemo(
    () =>
      filterYearbookArchive(archive, {
        query,
        brand: filters.brand,
        gender: filters.gender,
        category: filters.category,
      }),
    [archive, filters, query],
  );
  const items = useMemo<Item[]>(() => {
    if (scope === "current")
      return sortCurrent(
        currentFiltered,
        sort,
        currency,
        prefs.rateSnapshot,
      ).map((value) => ({ kind: "current", value }));
    return sortArchive(archiveFiltered, sort, currency, prefs.rateSnapshot).map(
      (value) => ({ kind: "archive", value }),
    );
  }, [
    archiveFiltered,
    currency,
    currentFiltered,
    prefs.rateSnapshot,
    scope,
    sort,
  ]);
  const brands =
    scope === "current"
      ? yearbookBrands(catalog)
      : [...new Set(archive.map((item) => item.brand_key))];
  const categories =
    scope === "current"
      ? yearbookCategories(catalog)
      : [...new Set(archive.flatMap((item) => item.categories))].sort();
  const years = yearbookYears(catalog);
  const regionOptions = availableDealRegions(allDeals);
  const activeCount =
    Number(filters.brand !== "all") +
    Number(filters.gender !== "all") +
    Number(filters.category !== "all") +
    Number(scope === "current" && filters.year !== "all");
  const activeChips: ActiveChip[] = [
    filters.brand !== "all"
      ? {
          key: "brand",
          label: brandLabel(filters.brand),
          onRemove: () => setFilters((value) => ({ ...value, brand: "all" })),
        }
      : null,
    filters.gender !== "all"
      ? {
          key: "gender",
          label: prefs.genderLabel(filters.gender),
          onRemove: () => setFilters((value) => ({ ...value, gender: "all" })),
        }
      : null,
    filters.category !== "all"
      ? {
          key: "category",
          label: prefs.categoryLabel(filters.category),
          onRemove: () =>
            setFilters((value) => ({ ...value, category: "all" })),
        }
      : null,
    scope === "current" && filters.year !== "all"
      ? {
          key: "year",
          label: String(filters.year),
          onRemove: () => setFilters((value) => ({ ...value, year: "all" })),
        }
      : null,
  ].filter(Boolean) as ActiveChip[];
  const sections: FilterSheetSection[] = [
    {
      key: "brand",
      title: b("brand"),
      value: filters.brand,
      options: [
        { value: "all", label: b("allBrands") },
        ...brands.map((value) => ({ value, label: brandLabel(value) })),
      ],
    },
    {
      key: "year",
      title: b("year"),
      value: String(filters.year),
      options: [
        { value: "all", label: b("allYears") },
        ...years.map((value) => ({
          value: String(value),
          label: String(value),
        })),
      ],
    },
    {
      key: "category",
      title: b("category"),
      value: filters.category,
      options: [
        { value: "all", label: b("allCategories") },
        ...categories.map((value) => ({
          value,
          label: prefs.categoryLabel(value),
        })),
      ],
    },
    {
      key: "gender",
      title: b("gender"),
      value: filters.gender,
      options: ["all", "women", "men", "kids", "unisex"].map((value) => ({
        value,
        label: value === "all" ? b("allGenders") : prefs.genderLabel(value),
      })),
    },
  ].filter((section) => scope === "current" || section.key !== "year");

  if (loading)
    return (
      <ScreenState
        title={prefs.t("yearbook.loadingTitle")}
        body={prefs.t("yearbook.loadingBody")}
        loading
      />
    );
  if (unavailable)
    return (
      <ScreenState
        title={prefs.t("yearbook.unavailableTitle")}
        body={prefs.t("yearbook.unavailableBody")}
        actionLabel={prefs.t("yearbook.retry")}
        onAction={() => void load()}
      />
    );
  if (!catalog.length)
    return (
      <ScreenState
        title={prefs.t("yearbook.emptyTitle")}
        body={prefs.t("yearbook.emptyBody")}
      />
    );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(item) =>
          item.kind === "current"
            ? item.value.catalog_product_id
            : item.value.archive_id
        }
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.top}>
              <Text style={styles.title}>{prefs.t("tabs.yearbook")}</Text>
              <MarketPill
                region={region}
                currency={currency}
                label={`${b("market")}: ${prefs.regionLabel(region)}`}
                onPress={() => setMarketOpen(true)}
              />
            </View>
            <View style={styles.segment}>
              <Segment
                active={scope === "current"}
                label={b("current", { count: catalog.length })}
                onPress={() => {
                  setScope("current");
                  setFilters((value) => ({ ...value, year: "all" }));
                }}
              />
              <Segment
                active={scope === "archive"}
                label={b("archive", { count: archive.length })}
                onPress={() => {
                  setScope("archive");
                  setFilters((value) => ({ ...value, year: "all" }));
                }}
              />
            </View>
            <Text style={styles.help}>
              {scope === "current" ? b("currentHelp") : b("archiveHelp")}
            </Text>
            <Text style={styles.source}>{b("officialSource")}</Text>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={b("searchYearbook")}
              clearAccessibilityLabel={b("clearSearch")}
            />
            <ControlRow
              sortLabel={`${b("sort")} · ${sortLabel(sort, prefs.language)}`}
              filterLabel={b("filters")}
              filterCount={activeCount}
              onSort={() => setSortOpen(true)}
              onFilter={() => setFiltersOpen(true)}
            />
            <ActiveChips chips={activeChips} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            {item.kind === "current" ? (
              <CurrentCard
                product={item.value}
                offers={
                  dealIndex.byCatalogId[item.value.catalog_product_id] || []
                }
                saved={watchlist.isModelSaved(item.value)}
                onOpen={() => setSelectedProduct(item.value)}
                onToggleSave={(offers) =>
                  void toggleModelWithFeedback(item.value, offers)
                }
              />
            ) : (
              <ArchiveCard product={item.value} />
            )}
          </View>
        )}
        ListEmptyComponent={
          <ScreenState
            title={prefs.t("yearbook.noMatchesTitle")}
            body={prefs.t("yearbook.noMatchesBody")}
          />
        }
      />
      <FilterSheet
        visible={filtersOpen}
        title={b("filters")}
        sections={sections}
        resultLabel={b("viewResults", { count: items.length })}
        resetLabel={b("reset")}
        onSelect={(key, value) =>
          setFilters((current) => ({
            ...current,
            [key]: key === "year" && value !== "all" ? Number(value) : value,
          }))
        }
        onReset={() =>
          setFilters({
            brand: "all",
            gender: "all",
            category: "all",
            year: "all",
          })
        }
        onClose={() => setFiltersOpen(false)}
      />
      <SortSheet
        visible={sortOpen}
        value={sort}
        language={prefs.language}
        onSelect={(value) => {
          setSort(value);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
      <MarketSheet
        visible={marketOpen}
        title={b("market")}
        region={region}
        currency={currency}
        regions={regionOptions.map((value) => ({
          value,
          label: prefs.regionLabel(value),
          currency:
            value === "all"
              ? b("localCurrency")
              : REGION_CURRENCY[value] || "—",
        }))}
        currencies={
          [
            { value: "original", label: b("localCurrency") },
            { value: "CNY", label: "CNY" },
            { value: "USD", label: "USD" },
            { value: "EUR", label: "EUR" },
          ] as Array<{ value: CurrencyPreference; label: string }>
        }
        ratesNote={b("ratesNote")}
        catalogNote={b("catalogMarketNote")}
        applyLabel={b("apply")}
        closeLabel={b("close")}
        errorLabel={b("marketSaveError")}
        onApply={(nextRegion, nextCurrency) =>
          setMarket({ region: nextRegion, currency: nextCurrency })
        }
        onClose={() => setMarketOpen(false)}
      />
      {selectedProduct ? (
        <CatalogDetailSheet
          product={selectedProduct}
          offers={
            dealIndex.byCatalogId[selectedProduct.catalog_product_id] || []
          }
          onClose={() => setSelectedProduct(null)}
          onAlert={() => {
            setAlertProduct(selectedProduct);
            setSelectedProduct(null);
          }}
          onToggleSave={() =>
            void toggleModelWithFeedback(
              selectedProduct,
              dealIndex.byCatalogId[selectedProduct.catalog_product_id] || [],
            )
          }
        />
      ) : null}
      {alertProduct ? (
        <AlertModal
          visible
          source={alertProduct}
          entry={watchlist.getModelEntry(alertProduct)}
          lockedScope="model"
          onClose={() => setAlertProduct(null)}
          onDelete={async () => {
            const entry = watchlist.getModelEntry(alertProduct);
            if (entry?.id) await watchlist.removeAlert(entry.id);
          }}
          onSubmit={(draft) =>
            watchlist.saveAlertForSource(
              alertProduct,
              "model",
              draft,
              dealIndex.byCatalogId[alertProduct.catalog_product_id] || [],
            )
          }
        />
      ) : null}
    </SafeAreaView>
  );
}

function CurrentCard({
  product,
  offers,
  saved,
  onOpen,
  onToggleSave,
}: {
  product: CatalogProduct;
  offers: Product[];
  saved: boolean;
  onOpen: () => void;
  onToggleSave: (offers: Product[]) => void;
}) {
  const prefs = usePreferences();
  const { currency } = useMarket();
  const { colors, styles } = useBrowseStyles();
  const b = (key: Parameters<typeof browseText>[1]) =>
    browseText(prefs.language, key);
  const selection = comparableYearbookOffer(
    offers,
    currency,
    prefs.rateSnapshot,
  );
  const best = selection.offer;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b("modelDetail")}: ${product.name}`}
      style={styles.card}
      onPress={onOpen}
    >
      <View style={styles.photo}>
        <DefaultImage
          category={product.categories[0] || "other"}
          brand={product.brand}
        />
        <Status
          tone={best ? "sale" : "list"}
          text={best ? b("onSale") : b("listPrice")}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={b("modelWatch")}
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 22,
            backgroundColor: colors.onPhotoBadge,
          }}
          onPress={(event) => {
            event.stopPropagation();
            onToggleSave(offers);
          }}
        >
          <Ionicons
            name={saved ? "heart" : "heart-outline"}
            size={17}
            color={saved ? "#B73535" : "#202326"}
          />
        </Pressable>
      </View>
      <Text style={styles.brandMeta}>
        {product.brand} ·{" "}
        {prefs.categoryLabel(product.categories[0] || "other")}
      </Text>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.price}>
        {best
          ? offerPriceLabel(offers, selection.comparableAcrossCurrencies, prefs)
          : formatRange(product, prefs)}
      </Text>
      <Text style={styles.marketMeta}>
        {best
          ? `${best.region.toUpperCase()} · ${PLATFORM[best._platform]?.label || best._platform}`
          : `${product.country.toUpperCase()} · ${product.currency}`}
      </Text>
    </Pressable>
  );
}

function ArchiveCard({ product }: { product: YearbookArchiveStyle }) {
  const prefs = usePreferences();
  const { currency } = useMarket();
  const { styles } = useBrowseStyles();
  const b = (key: Parameters<typeof browseText>[1]) =>
    browseText(prefs.language, key);
  const selection = comparableYearbookOffer(
    product.offers,
    currency,
    prefs.rateSnapshot,
  );
  const best = selection.offer;
  if (!best) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b("viewDeal")}: ${product.name}`}
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: "/product/[skuId]",
          params: { skuId: best.sku_id },
        })
      }
    >
      <View style={styles.photo}>
        <DefaultImage
          category={product.categories[0] || productCategory(best)}
          brand={BRAND[product.brand_key].label}
        />
        <Status tone="archive" text={b("archiveFrom")} />
      </View>
      <Text style={styles.brandMeta}>
        {BRAND[product.brand_key].label} ·{" "}
        {prefs.categoryLabel(product.categories[0] || productCategory(best))}
      </Text>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.price}>
        {offerPriceLabel(
          product.offers,
          selection.comparableAcrossCurrencies,
          prefs,
        )}
      </Text>
      <Text style={styles.marketMeta}>
        {best.region.toUpperCase()} ·{" "}
        {PLATFORM[best._platform]?.label || best._platform}
      </Text>
    </Pressable>
  );
}

function CatalogDetailSheet({
  product,
  offers,
  onClose,
  onAlert,
  onToggleSave,
}: {
  product: CatalogProduct;
  offers: Product[];
  onClose: () => void;
  onAlert: () => void;
  onToggleSave: () => void;
}) {
  const prefs = usePreferences();
  const { currency } = useMarket();
  const watchlist = useWatchlist();
  const { colors, styles } = useBrowseStyles();
  const b = (key: Parameters<typeof browseText>[1]) =>
    browseText(prefs.language, key);
  const selection = comparableYearbookOffer(
    offers,
    currency,
    prefs.rateSnapshot,
  );
  const best = selection.offer;
  const saved = watchlist.isModelSaved(product);

  function openAlert() {
    onAlert();
  }

  function viewDeal() {
    if (!best) return;
    onClose();
    router.push({
      pathname: "/product/[skuId]",
      params: { skuId: best.sku_id },
    });
  }

  return (
    <Modal
      visible
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.detailSheet}
          contentContainerStyle={styles.detailContent}
        >
          <View style={styles.detailHead}>
            <Text style={styles.detailTitle}>{b("modelDetail")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={b("close")}
              style={styles.detailClose}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.detailBrand}>
            {product.brand} ·{" "}
            {prefs.categoryLabel(product.categories[0] || "other")}
          </Text>
          <Text style={styles.detailName}>{product.name}</Text>
          <Text style={styles.detailLabel}>{b("officialPrice")}</Text>
          <Text style={styles.detailPrice}>{formatRange(product, prefs)}</Text>
          <Text style={styles.detailMeta}>
            {product.country.toUpperCase()} · {product.currency}
          </Text>
          {best ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={b("viewDeal")}
              style={styles.detailPrimary}
              onPress={viewDeal}
            >
              <Text style={styles.detailPrimaryText}>
                {b("viewDeal")} ·{" "}
                {offerPriceLabel(
                  offers,
                  selection.comparableAcrossCurrencies,
                  prefs,
                )}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={b("openOfficial")}
            style={styles.detailSecondary}
            onPress={() => void Linking.openURL(product.source_url)}
          >
            <Text style={styles.detailSecondaryText}>{b("openOfficial")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={b("modelWatch")}
            style={styles.detailSecondary}
            onPress={onToggleSave}
          >
            <Text style={styles.detailSecondaryText}>
              {b("modelWatch")} · {saved ? "✓" : "+"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={b("setAlert")}
            style={styles.detailSecondary}
            onPress={openAlert}
          >
            <Text style={styles.detailSecondaryText}>{b("setAlert")}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function offerPriceLabel(
  offers: Product[],
  comparable: boolean,
  prefs: ReturnType<typeof usePreferences>,
) {
  const rows = bestYearbookOffers(offers);
  if (comparable) {
    const selected = comparableYearbookOffer(
      offers,
      prefs.currency,
      prefs.rateSnapshot,
    ).offer;
    return selected
      ? prefs.formatMoney(
          selected.sale_price,
          selected.currency,
          selected.symbol,
        )
      : "";
  }
  return rows
    .slice(0, 2)
    .map(
      (offer) =>
        `${offer.currency} ${prefs.formatOriginalMoney(offer.sale_price, offer.currency, offer.symbol)}`,
    )
    .join(" · ");
}

function Status({
  tone,
  text,
}: {
  tone: "sale" | "list" | "archive";
  text: string;
}) {
  const { styles } = useBrowseStyles();
  return (
    <View
      style={[
        styles.status,
        tone === "sale"
          ? styles.statusSale
          : tone === "archive"
            ? styles.statusArchive
            : styles.statusList,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          tone === "sale"
            ? styles.statusSaleText
            : tone === "archive"
              ? styles.statusArchiveText
              : styles.statusListText,
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}
function Segment({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { styles } = useBrowseStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segmentButton, active && styles.segmentActive]}
      onPress={onPress}
    >
      <Text
        style={[styles.segmentText, active && styles.segmentTextActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function formatRange(
  product: CatalogProduct,
  prefs: ReturnType<typeof usePreferences>,
) {
  const min = prefs.formatMoney(product.list_price, product.currency);
  const max = prefs.formatMoney(product.list_price_max, product.currency);
  return product.list_price_max > product.list_price ? `${min}–${max}` : min;
}
function sortablePrice(
  value: number,
  source: string,
  target: CurrencyPreference,
  snapshot: RateSnapshot | null,
) {
  const comparison = target === "original" ? "EUR" : target;
  const result = convertAmount(value, source, comparison, snapshot);
  return result.currency === comparison ? result.value : null;
}
function comparePrice(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
) {
  if (left !== null && right !== null) return direction * (left - right);
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}
function sortCurrent(
  rows: CatalogProduct[],
  sort: Sort,
  currency: CurrencyPreference,
  snapshot: RateSnapshot | null,
) {
  return [...rows].sort((a, b) =>
    sort === "price_asc"
      ? comparePrice(
          sortablePrice(a.list_price, a.currency, currency, snapshot),
          sortablePrice(b.list_price, b.currency, currency, snapshot),
          1,
        ) || a.currency.localeCompare(b.currency)
      : sort === "price_desc"
        ? comparePrice(
            sortablePrice(a.list_price, a.currency, currency, snapshot),
            sortablePrice(b.list_price, b.currency, currency, snapshot),
            -1,
          ) || a.currency.localeCompare(b.currency)
        : sort === "newest"
          ? yearbookYear(b) - yearbookYear(a)
          : a.name.localeCompare(b.name),
  );
}
function sortArchive(
  rows: YearbookArchiveStyle[],
  sort: Sort,
  currency: CurrencyPreference,
  snapshot: RateSnapshot | null,
) {
  return [...rows].sort((a, b) => {
    const ao = comparableYearbookOffer(a.offers, currency, snapshot).offer;
    const bo = comparableYearbookOffer(b.offers, currency, snapshot).offer;
    const ap = ao
      ? sortablePrice(ao.sale_price, ao.currency, currency, snapshot)
      : null;
    const bp = bo
      ? sortablePrice(bo.sale_price, bo.currency, currency, snapshot)
      : null;
    return sort === "price_asc"
      ? comparePrice(ap, bp, 1) || a.name.localeCompare(b.name)
      : sort === "price_desc"
        ? comparePrice(ap, bp, -1) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name);
  });
}
function sortLabel(sort: Sort, language: Parameters<typeof browseText>[0]) {
  const labels = {
    en: {
      name: "Name",
      price_asc: "Lowest price",
      price_desc: "Highest price",
      newest: "Newest",
    },
    "zh-Hans": {
      name: "名称",
      price_asc: "价格从低到高",
      price_desc: "价格从高到低",
      newest: "最新年份",
    },
    de: {
      name: "Name",
      price_asc: "Niedrigster Preis",
      price_desc: "Höchster Preis",
      newest: "Neueste zuerst",
    },
    fr: {
      name: "Nom",
      price_asc: "Prix croissant",
      price_desc: "Prix décroissant",
      newest: "Plus récents",
    },
    ja: {
      name: "名前",
      price_asc: "価格の安い順",
      price_desc: "価格の高い順",
      newest: "新しい順",
    },
  };
  return labels[language][sort];
}
function SortSheet({
  visible,
  value,
  language,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: Sort;
  language: Parameters<typeof browseText>[0];
  onSelect: (value: Sort) => void;
  onClose: () => void;
}) {
  const { colors, styles } = useBrowseStyles();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sortSheet}>
          {(["name", "price_asc", "price_desc", "newest"] as Sort[]).map(
            (option) => (
              <Pressable
                key={option}
                style={styles.sortOption}
                onPress={() => onSelect(option)}
              >
                <Text style={styles.sortOptionText}>
                  {sortLabel(option, language)}
                </Text>
                {option === value ? (
                  <Ionicons name="checkmark" size={18} color={colors.buy} />
                ) : null}
              </Pressable>
            ),
          )}
        </View>
      </View>
    </Modal>
  );
}

function useBrowseStyles() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return { colors, styles };
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.screen },
    content: { paddingHorizontal: 15, paddingBottom: 28 },
    header: { gap: 9, paddingTop: 2, paddingBottom: 10 },
    top: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
    segment: {
      height: 44,
      flexDirection: "row",
      borderRadius: 11,
      backgroundColor: colors.card,
      padding: 3,
    },
    segmentButton: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 9,
    },
    segmentActive: { backgroundColor: colors.pill },
    segmentText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
    segmentTextActive: { color: colors.onPill },
    help: { color: colors.ink2, fontSize: 12, lineHeight: 17 },
    source: { color: colors.muted, fontSize: 10.5, lineHeight: 15 },
    columns: { gap: 10 },
    item: { minWidth: 0, flex: 1, maxWidth: "50%" },
    card: { flex: 1, gap: 4, paddingBottom: 14 },
    photo: {
      width: "100%",
      aspectRatio: 4 / 5,
      overflow: "hidden",
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.photo,
    },
    status: {
      position: "absolute",
      top: 7,
      left: 7,
      maxWidth: "84%",
      borderRadius: radii.sm,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    statusSale: { backgroundColor: colors.buyBg },
    statusArchive: { backgroundColor: colors.discBg },
    statusList: { backgroundColor: colors.onPhotoBadge },
    statusText: { fontSize: 9.5, fontWeight: "900" },
    statusSaleText: { color: colors.buy },
    statusArchiveText: { color: colors.disc },
    statusListText: { color: "#34383C" },
    brandMeta: { color: colors.muted, fontSize: 10.5, fontWeight: "700" },
    name: {
      minHeight: 34,
      color: colors.ink,
      fontSize: 13.5,
      lineHeight: 17,
      fontWeight: "800",
    },
    price: {
      color: colors.disc,
      fontFamily: typography.mono,
      fontVariant: typography.tabular,
      fontSize: 14.5,
      fontWeight: "900",
    },
    marketMeta: { color: colors.muted, fontSize: 10.5 },
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(8,9,10,.42)",
    },
    sortSheet: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.card,
      padding: 18,
      paddingBottom: 30,
    },
    sortOption: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sortOptionText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
    detailSheet: {
      flexGrow: 0,
      flexShrink: 1,
      maxHeight: "90%",
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.card,
    },
    detailContent: {
      gap: 10,
      padding: 20,
      paddingBottom: 34,
    },
    detailHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    detailTitle: { color: colors.ink, fontSize: 20, fontWeight: "900" },
    detailClose: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    detailBrand: { color: colors.muted, fontSize: 11, fontWeight: "800" },
    detailName: {
      color: colors.ink,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "900",
    },
    detailLabel: {
      color: colors.muted,
      marginTop: 4,
      fontSize: 11,
      fontWeight: "800",
    },
    detailPrice: {
      color: colors.disc,
      fontFamily: typography.mono,
      fontSize: 20,
      fontWeight: "900",
    },
    detailMeta: { color: colors.muted, fontSize: 11 },
    detailPrimary: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.pill,
      paddingHorizontal: 12,
    },
    detailPrimaryText: {
      color: colors.onPill,
      fontSize: 13,
      fontWeight: "900",
      textAlign: "center",
    },
    detailSecondary: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      paddingHorizontal: 12,
    },
    detailSecondaryText: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: "800",
      textAlign: "center",
    },
  });
