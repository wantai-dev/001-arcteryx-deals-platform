import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MarketSheet } from "../../components/MarketSheet";
import { useProducts } from "../../contexts/ProductsContext";
import { usePreferences } from "../../contexts/PreferencesContext";
import { usePro } from "../../contexts/ProContext";
import { useTheme } from "../../contexts/ThemeContext";
import { browseText } from "../../lib/browseI18n";
import { availableDealRegions } from "../../lib/deals";
import {
  LANGUAGE_LABELS,
  LANGUAGE_OPTIONS,
  LanguageChoice,
} from "../../lib/i18n";
import { AppearancePreference } from "../../lib/preferences";
import {
  marketCurrencyOptions,
  marketRegionOptions,
} from "../../lib/marketOptions";
import {
  openSupportUrl,
  requestNotificationPermission,
} from "../../lib/actions";
import { ThemeColors, radii } from "../../lib/theme";

const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

export default function MeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isPro, managementURL, state } = usePro();
  const { products, loadedCount } = useProducts();
  const p = usePreferences();
  const b = (
    key: Parameters<typeof browseText>[1],
    params?: Record<string, string | number>,
  ) => browseText(p.language, key, params);
  const [picker, setPicker] = useState<
    "market" | "language" | "appearance" | null
  >(null);
  const regions = useMemo(() => availableDealRegions(products), [products]);
  async function toggleNotifications(next: boolean) {
    try {
      if (!next) return await p.setNotificationsEnabled(false);
      const granted = await requestNotificationPermission();
      await p.setNotificationsEnabled(granted);
      if (!granted)
        Alert.alert(
          p.t("me.notificationsDisabled"),
          p.t("me.notificationsDisabledBody"),
        );
    } catch {
      Alert.alert(p.t("me.preferencesSaveError"));
    }
  }
  async function openManagePro() {
    if (!isPro) {
      router.push("/paywall");
      return;
    }
    try {
      await Linking.openURL(managementURL || APPLE_SUBSCRIPTIONS_URL);
    } catch {
      Alert.alert(p.t("me.openSubscriptionsError"));
    }
  }
  const appearanceLabel = p.t(`me.appearance.${p.appearance}`);
  const languageLabel =
    p.languageChoice === "system"
      ? p.t("me.languageSystem")
      : LANGUAGE_LABELS[p.languageChoice];
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{p.t("me.title")}</Text>
        <View style={styles.proCard}>
          <View>
            <Text style={styles.proTitle}>
              {isPro ? p.t("me.proActive") : p.t("me.freeMode")}
            </Text>
            <Text style={styles.sub}>
              {state === "loading"
                ? p.t("me.proChecking")
                : state === "ready"
                  ? p.t("me.available", { count: p.formatNumber(loadedCount) })
                  : p.t("me.proUnavailable")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.proButton}
            onPress={() => void openManagePro()}
          >
            <Text style={styles.proButtonText}>
              {isPro ? p.t("me.managePro") : p.t("me.upgrade")}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.section}>{p.t("me.preferences")}</Text>
        {p.preferencesError ? (
          <View style={styles.preferencesError}>
            <View style={styles.flex}>
              <Text accessibilityRole="alert" style={styles.preferencesErrorTitle}>
                {p.t("me.preferencesLoadError")}
              </Text>
              <Text style={styles.rowSub}>
                {p.t("me.preferencesLoadErrorBody")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.preferencesRetry}
              onPress={() => void p.retryPreferences()}
            >
              <Text style={styles.preferencesRetryText}>
                {p.t("me.retryPreferences")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.card}>
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.market")}
            value={`${p.regionLabel(p.region)} · ${p.currency === "original" ? p.t("me.currencyOriginal") : p.currency}`}
            onPress={() => setPicker("market")}
          />
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.language")}
            value={languageLabel}
            onPress={() => setPicker("language")}
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{p.t("me.notifications")}</Text>
              <Text style={styles.rowSub}>{p.t("me.notificationsSub")}</Text>
            </View>
            <Switch
              accessibilityLabel={p.t("me.notifications")}
              value={p.notificationsEnabled}
              onValueChange={(v) => void toggleNotifications(v)}
              trackColor={{ false: colors.hair2 as string, true: colors.buy }}
            />
          </View>
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.appearance")}
            value={appearanceLabel}
            onPress={() => setPicker("appearance")}
          />
        </View>
        <Text style={styles.section}>{p.t("me.about")}</Text>
        <View style={styles.card}>
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.website")}
            onPress={() =>
              void WebBrowser.openBrowserAsync("https://geardrop.100app.dev")
            }
            external
          />
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.support")}
            onPress={openSupportUrl}
            external
          />
          <Row
            styles={styles}
            colors={colors}
            label={p.t("me.privacy")}
            onPress={() => router.push("/privacy")}
          />
        </View>
        <Text style={styles.version}>
          {p.t("me.version", {
            version: Constants.expoConfig?.version || "—",
            build: Constants.expoConfig?.ios?.buildNumber || "—",
          })}
        </Text>
      </ScrollView>
      <Picker
        visible={picker === "language"}
        title={p.t("me.language")}
        value={p.languageChoice}
        options={LANGUAGE_OPTIONS.map((v) => ({
          value: v,
          label: v === "system" ? p.t("me.languageSystem") : LANGUAGE_LABELS[v],
        }))}
        closeLabel={p.t("common.cancel")}
        errorLabel={p.t("me.preferencesSaveError")}
        onClose={() => setPicker(null)}
        onSelect={(v) => p.setLanguage(v as LanguageChoice)}
        colors={colors}
      />
      <Picker
        visible={picker === "appearance"}
        title={p.t("me.appearance")}
        value={p.appearance}
        options={(["system", "light", "dark"] as AppearancePreference[]).map(
          (v) => ({ value: v, label: p.t(`me.appearance.${v}`) }),
        )}
        closeLabel={p.t("common.cancel")}
        errorLabel={p.t("me.preferencesSaveError")}
        onClose={() => setPicker(null)}
        onSelect={(v) => p.setAppearance(v as AppearancePreference)}
        colors={colors}
      />
      <MarketSheet
        visible={picker === "market"}
        title={b("market")}
        region={p.region}
        currency={p.currency}
        regions={marketRegionOptions(
          regions,
          (value) => p.regionLabel(value),
          b("localCurrency"),
        )}
        currencies={marketCurrencyOptions(p.currency, b("localCurrency"))}
        ratesNote={b("ratesNote")}
        catalogNote={b("catalogMarketNote")}
        applyLabel={b("apply")}
        closeLabel={b("close")}
        errorLabel={b("marketSaveError")}
        onApply={(region, currency) => p.setMarket({ region, currency })}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

function Row({
  styles,
  colors,
  label,
  value,
  onPress,
  external,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  label: string;
  value?: string;
  onPress: () => void;
  external?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, value].filter(Boolean).join(", ")}
      style={styles.row}
      onPress={onPress}
    >
      <Text style={styles.rowTitle}>{label}</Text>
      <View style={styles.value}>
        <Text style={styles.valueText}>{value}</Text>
        <Ionicons
          name={external ? "open-outline" : "chevron-forward"}
          size={17}
          color={colors.muted}
        />
      </View>
    </Pressable>
  );
}
function Picker({
  visible,
  title,
  value,
  options,
  closeLabel,
  errorLabel,
  onClose,
  onSelect,
  colors,
}: {
  visible: boolean;
  title: string;
  value: string;
  options: { value: string; label: string }[];
  closeLabel: string;
  errorLabel: string;
  onClose: () => void;
  onSelect: (v: string) => Promise<void>;
  colors: ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (visible) setSaveError(false);
  }, [visible]);
  async function select(value: string) {
    if (busy) return;
    setBusy(true);
    setSaveError(false);
    try {
      await onSelect(value);
      onClose();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={s.close}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
          {options.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: o.value === value, disabled: busy }}
              disabled={busy}
              style={s.option}
              onPress={() => void select(o.value)}
            >
              <Text style={s.rowTitle}>{o.label}</Text>
              {busy && o.value !== value ? null : o.value === value ? (
                <Ionicons name="checkmark" size={19} color={colors.buy} />
              ) : null}
            </Pressable>
          ))}
          {busy ? <ActivityIndicator color={colors.ink} /> : null}
          {saveError ? <Text accessibilityRole="alert" style={s.saveError}>{errorLabel}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}
function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingBottom: 38, gap: 12 },
    title: { color: c.ink, fontSize: 34, lineHeight: 40, fontWeight: "900" },
    proCard: {
      minHeight: 126,
      padding: 18,
      borderRadius: 14,
      backgroundColor: c.pill,
      justifyContent: "space-between",
      gap: 14,
    },
    proTitle: { color: c.onPill, fontSize: 18, fontWeight: "900" },
    sub: { color: c.onPill, marginTop: 4, fontSize: 13 },
    proButton: {
      minHeight: 44,
      alignSelf: "flex-end",
      justifyContent: "center",
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: c.card,
    },
    proButtonText: { color: c.ink, fontWeight: "900" },
    section: {
      color: c.muted,
      marginTop: 8,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.7,
    },
    card: {
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    preferencesError: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.disc,
      backgroundColor: c.card,
      padding: 14,
    },
    preferencesErrorTitle: {
      color: c.ink,
      fontSize: 14,
      fontWeight: "800",
      marginBottom: 3,
    },
    preferencesRetry: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    preferencesRetryText: { color: c.disc, fontSize: 13, fontWeight: "900" },
    row: {
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    flex: { flex: 1 },
    rowTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 12, lineHeight: 17 },
    value: {
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    valueText: {
      flexShrink: 1,
      color: c.muted,
      fontSize: 13,
      textAlign: "right",
    },
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(8,9,10,.45)",
    },
    sheet: {
      maxHeight: "88%",
      padding: 18,
      paddingBottom: 34,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: c.card,
    },
    sheetHead: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sheetTitle: { color: c.ink, fontSize: 20, fontWeight: "900" },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    option: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    saveError: { color: c.disc, fontSize: 12, lineHeight: 17, marginTop: 10 },
    version: { color: c.muted, fontSize: 11, textAlign: "center", marginTop: 4 },
  });
}
