import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { TopoPlaceholder } from "./TopoPlaceholder";
import { usePreferences } from "../contexts/PreferencesContext";
import { useTheme } from "../contexts/ThemeContext";
import { browseText } from "../lib/browseI18n";
import {
  BRAND,
  freshnessLabel,
  productCategory,
  productName,
  regionFlag,
  staleDays,
} from "../lib/catalog";
import { radii, text, typography, type ThemeColors } from "../lib/theme";
import { scaleLength, TYPE_CAP } from "../lib/typeScale";
import type { DealSignal, Product } from "../lib/types";

type Props = {
  product: Product;
  signal?: DealSignal;
  saved?: boolean;
  hero?: boolean;
  onPress: () => void;
  onToggleSave?: () => void;
};

export function DealCard({
  product,
  signal,
  saved = false,
  hero = false,
  onPress,
  onToggleSave,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const { categoryLabel, displayedCurrency, formatMoney, language, t } =
    usePreferences();
  const name = productName(product);
  const imageCandidates = Array.from(
    new Set([product.image_url, ...product.images].filter(Boolean)),
  ) as string[];
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const imageUri = imageCandidates.find((uri) => !failedImages[uri]);
  const stale = staleDays(product.last_updated) > 3;
  const category = categoryLabel(productCategory(product));
  const categoryWithBrand = `${BRAND[product._brand].label} · ${category}`;
  const allTimeLow = signal?.kind === "all_time_low";
  const signalLabel = stale
    ? t("signal.seen", { when: freshnessLabel(product.last_updated) })
    : signal?.kind === "all_time_low"
      ? browseText(language, "allTimeLow")
      : signal?.kind === "ninety_day_low"
        ? browseText(language, "ninetyDayLow")
        : signal?.kind === "drop_today" && signal.dropAmount
          ? browseText(language, "droppedToday")
          : signal?.kind === "steady"
            ? browseText(language, "steady")
            : signal?.kind === "insufficient"
              ? t("signal.off", { percent: product.discount_pct })
              : t("signal.checking");
  const signalStyle = stale
    ? styles.signalStale
    : signal?.tone === "success"
      ? styles.signalGood
      : styles.signalFlat;

  useEffect(() => {
    setFailedImages({});
  }, [product.sku_id]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${categoryWithBrand}, ${formatMoney(product.sale_price, product.currency, product.symbol)}, ${signalLabel}`}
      style={[styles.card, hero && styles.heroCard]}
      onPress={onPress}
    >
      <View style={styles.imageWrap}>
        <TopoPlaceholder
          category={productCategory(product)}
          brand={BRAND[product._brand].label}
          showLabel
        />
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            contentFit="cover"
            transition={160}
            onError={() =>
              setFailedImages((current) => ({ ...current, [imageUri]: true }))
            }
          />
        ) : null}
        {allTimeLow ? (
          <View style={styles.lowRibbon}>
            <Ionicons name="star" size={9} color="#FFFFFF" />
            <Text
              style={styles.lowRibbonText}
              maxFontSizeMultiplier={TYPE_CAP.badge}
            >
              {t("signal.all_time_low")}
            </Text>
          </View>
        ) : (
          <View style={styles.imageBadge}>
            <Text
            style={styles.imageBadgeText}
            maxFontSizeMultiplier={TYPE_CAP.badge}
          >
            -{product.discount_pct}%
          </Text>
          </View>
        )}
        <View style={styles.regionBadge}>
          <Text style={styles.regionBadgeText}>
            {regionFlag(product.region)}
          </Text>
        </View>
        {onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? t("watch.remove") : t("watch.save")}
            accessibilityState={{ selected: saved }}
            style={[
              styles.saveButton,
              {
                width: scaleLength(44, fontScale, { max: 1.3 }),
                height: scaleLength(44, fontScale, { max: 1.3 }),
              },
            ]}
            onPress={(event) => {
              event.stopPropagation();
              onToggleSave();
            }}
          >
            <Ionicons
              name={saved ? "heart" : "heart-outline"}
              color={saved ? "#B73535" : "#202326"}
              size={16}
            />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text
          style={styles.category}
          numberOfLines={1}
          maxFontSizeMultiplier={TYPE_CAP.compact}
        >
          {categoryWithBrand}
        </Text>
        <Text style={[styles.name, hero && styles.heroName]} numberOfLines={2}>
          {name}
        </Text>
        {hero ? (
          <Text style={styles.meta} numberOfLines={1}>
            {[product.color, product.gender].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        <View style={styles.priceRow}>
          <Text style={[styles.sale, hero && styles.heroSale]}>
            {formatMoney(product.sale_price, product.currency, product.symbol)}{" "}
            <Text style={styles.currencyCode}>
              {displayedCurrency(product.currency)}
            </Text>
          </Text>
          {product.original_price > product.sale_price ? (
            <Text style={styles.original}>
              {formatMoney(
                product.original_price,
                product.currency,
                product.symbol,
              )}
            </Text>
          ) : null}
        </View>
        <Text
          style={[styles.signal, signalStyle]}
          numberOfLines={1}
          maxFontSizeMultiplier={TYPE_CAP.compact}
        >
          {signalLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const numeric = {
  fontFamily: typography.mono,
  fontVariant: typography.tabular,
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flex: 1,
      gap: 7,
      paddingBottom: 12,
    },
    heroCard: {
      paddingBottom: 12,
    },
    imageWrap: {
      width: "100%",
      aspectRatio: 4 / 5,
      overflow: "hidden",
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.photo,
    },
    image: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: "100%",
      height: "100%",
    },
    imageBadge: {
      position: "absolute",
      top: 7,
      left: 7,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.discLine,
      backgroundColor: colors.onPhotoBadge,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    imageBadgeText: {
      ...text.caption2Emphasized,
      ...numeric,
      color: colors.onPhotoDisc,
    },
    lowRibbon: {
      position: "absolute",
      top: 7,
      left: 7,
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderRadius: radii.sm,
      backgroundColor: "#1E7A52",
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    lowRibbonText: {
      ...text.caption2Emphasized,
      color: "#FFFFFF",
    },
    regionBadge: {
      position: "absolute",
      top: 7,
      right: 7,
      minWidth: 20,
      minHeight: 16,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 4,
      backgroundColor: colors.onPhotoBadge,
    },
    regionBadgeText: {
      ...text.caption2,
      fontFamily: typography.mono,
      fontVariant: typography.tabular,
    },
    body: {
      minWidth: 0,
      gap: 4,
    },
    category: { ...text.caption1Emphasized, color: colors.muted },
    name: {
      ...text.subheadEmphasized,
      lineHeight: 19,
      color: colors.ink,
    },
    heroName: {
      ...text.calloutEmphasized,
    },
    meta: {
      ...text.caption1,
      color: colors.muted,
      marginTop: 1,
    },
    saveButton: {
      position: "absolute",
      right: 7,
      bottom: 7,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: colors.onPhotoBadge,
    },
    currencyCode: {
      ...text.caption2Emphasized,
      color: colors.muted,
      fontFamily: typography.mono,
    },
    signal: {
      ...text.caption1Emphasized,
    },
    signalGood: {
      color: colors.buy,
    },
    signalFlat: {
      color: colors.muted,
      fontWeight: "400",
    },
    signalStale: {
      color: colors.faint,
      fontWeight: "400",
    },
    priceRow: {
      flexDirection: "row",
      alignItems: "baseline",
      flexWrap: "wrap",
      gap: 7,
    },
    sale: {
      ...text.calloutEmphasized,
      ...numeric,
      color: colors.disc,
      fontWeight: "700",
      letterSpacing: 0,
    },
    heroSale: {
      fontSize: 17,
      lineHeight: 22,
    },
    original: {
      ...text.caption1,
      ...numeric,
      color: colors.faint,
      textDecorationLine: "line-through",
    },
  });
