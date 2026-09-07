import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { regionFlag } from "../lib/catalog";
import type { CurrencyPreference } from "../lib/currency";
import { radii, type ThemeColors } from "../lib/theme";

type RegionOption = { value: string; label: string; currency: string };
type Props = {
  visible: boolean;
  title: string;
  region: string;
  currency: CurrencyPreference;
  regions: RegionOption[];
  currencies: Array<{ value: CurrencyPreference; label: string }>;
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
    <Modal
      visible={props.visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={props.onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
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
                  accessibilityState={{ checked: selected, disabled: busy }}
                  style={styles.region}
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
                    style={[styles.currency, selected && styles.currencyActive]}
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
            style={[styles.apply, busy && styles.disabled]}
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
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(8,9,10,.42)",
    },
    sheet: {
      maxHeight: "88%",
      gap: 14,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.card,
      padding: 18,
      paddingBottom: 30,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { color: colors.ink, fontSize: 20, fontWeight: "900" },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: { flexShrink: 1 },
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
    flag: { fontSize: 18 },
    regionCopy: { flex: 1 },
    regionName: { color: colors.ink, fontSize: 14, fontWeight: "800" },
    regionCurrency: { color: colors.muted, fontSize: 11.5 },
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
    currencyText: { color: colors.ink2, fontSize: 12, fontWeight: "800" },
    currencyTextActive: { color: colors.onPill },
    note: { color: colors.muted, fontSize: 11.5, lineHeight: 17 },
    error: { color: colors.disc, fontSize: 12, fontWeight: "800" },
    apply: {
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.pill,
    },
    disabled: { opacity: 0.55 },
    applyText: { color: colors.onPill, fontSize: 14, fontWeight: "900" },
  });
