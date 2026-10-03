import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Sheet } from "./Sheet";

import { useTheme } from "../contexts/ThemeContext";
import { regionFlag } from "../lib/catalog";
import type { CurrencyPreference } from "../lib/currency";
import type {
  MarketCurrencyOption,
  MarketRegionOption,
} from "../lib/marketOptions";
import { radii, text, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";

type Props = {
  visible: boolean;
  title: string;
  region: string;
  currency: CurrencyPreference;
  regions: MarketRegionOption[];
  currencies: MarketCurrencyOption[];
  ratesNote: string;
  catalogNote: string;
  applyLabel: string;
  closeLabel: string;
  errorLabel: string;
  onApply: (region: string, currency: CurrencyPreference) => Promise<void>;
  onClose: () => void;
};

export function MarketSheet(props: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const [draftRegion, setDraftRegion] = useState(props.region);
  const [draftCurrency, setDraftCurrency] = useState(props.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!props.visible) return;
    setDraftRegion(props.region);
    setDraftCurrency(props.currency);
    setError(false);
  }, [props.currency, props.region, props.visible]);

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await props.onApply(draftRegion, draftCurrency);
      props.onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      detents={[0.6, 0.9]}
      closeAccessibilityLabel={props.closeLabel}
      style={styles.sheet}
    >
      <View style={styles.inner}>
          <View style={styles.head}>
            <Text style={styles.title}>{props.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.closeLabel}
              style={styles.close}
              onPress={props.onClose}
              disabled={busy}
            >
              <Ionicons name="close" size={21} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            {props.regions.map((option) => {
              const selected = draftRegion === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.label}, ${option.currency}`}
                  accessibilityState={{ checked: selected, disabled: busy }}
                  style={[styles.region, { minHeight: scaleLength(52, fontScale) }]}
                  onPress={() => setDraftRegion(option.value)}
                  disabled={busy}
                >
                  <Text style={styles.flag}>{regionFlag(option.value)}</Text>
                  <View style={styles.regionCopy}>
                    <Text style={styles.regionName}>{option.label}</Text>
                    <Text style={styles.regionCurrency}>{option.currency}</Text>
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.buy}
                    />
                  ) : (
                    <View style={styles.radio} />
                  )}
                </Pressable>
              );
            })}
            <View style={styles.currencies} accessibilityRole="radiogroup">
              {props.currencies.map((option) => {
                const selected = option.value === draftCurrency;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: busy }}
                    style={[
                      styles.currency,
                      { minHeight: scaleLength(44, fontScale) },
                      selected && styles.currencyActive,
                    ]}
                    onPress={() => setDraftCurrency(option.value)}
                    disabled={busy}
                  >
                    <Text
                      style={[
                        styles.currencyText,
                        selected && styles.currencyTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.note}>{props.ratesNote}</Text>
            <Text style={styles.note}>{props.catalogNote}</Text>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {props.errorLabel}
              </Text>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.applyLabel}
            accessibilityState={{ busy, disabled: busy }}
            style={[
              styles.apply,
              { minHeight: scaleLength(52, fontScale) },
              busy && styles.disabled,
            ]}
            onPress={() => void apply()}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPill} />
            ) : (
              <Text style={styles.applyText}>{props.applyLabel}</Text>
            )}
          </Pressable>
      </View>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: { backgroundColor: colors.card },
    inner: { flex: 1, gap: 14, padding: 18, paddingTop: 6, paddingBottom: 12 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { ...text.title3, color: colors.ink },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: { flex: 1 },
    content: { gap: 8 },
    region: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingHorizontal: 4,
    },
    flag: { fontSize: 20 },
    regionCopy: { flex: 1 },
    regionName: { ...text.body, color: colors.ink },
    regionCurrency: { ...text.footnote, color: colors.muted },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    currencies: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingTop: 12,
    },
    currency: {
      minHeight: 44,
      justifyContent: "center",
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      paddingHorizontal: 13,
    },
    currencyActive: { backgroundColor: colors.pill, borderColor: colors.pill },
    currencyText: { ...text.footnote, color: colors.ink2 },
    currencyTextActive: { color: colors.onPill },
    note: { ...text.caption1, color: colors.muted, lineHeight: 17 },
    error: { ...text.footnoteEmphasized, color: colors.disc },
    apply: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.pill,
    },
    disabled: { opacity: 0.55 },
    applyText: { ...text.headline, color: colors.onPill },
  });
