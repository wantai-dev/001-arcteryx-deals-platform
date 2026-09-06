import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { useProducts } from "../../contexts/ProductsContext";
import { usePreferences } from "../../contexts/PreferencesContext";
import { usePro } from "../../contexts/ProContext";
import { useTheme } from "../../contexts/ThemeContext";
import { CURRENCY_OPTIONS, CurrencyPreference } from "../../lib/currency";
import { regionFlag } from "../../lib/catalog";
import {
  LANGUAGE_LABELS,
  LANGUAGE_OPTIONS,
  LanguageChoice,
} from "../../lib/i18n";
import { AppearancePreference } from "../../lib/preferences";
import {
  openSupportUrl,
  requestNotificationPermission,
} from "../../lib/actions";
import { ThemeColors, radii } from "../../lib/theme";

const LOCAL_CURRENCY: Record<string, CurrencyPreference> = {
  us: "USD",
  ca: "CAD",
  gb: "GBP",
  au: "original",
  de: "EUR",
  fr: "EUR",
  nl: "EUR",
  fi: "EUR",
  ie: "EUR",
  at: "EUR",
  be: "EUR",
  dk: "original",
  it: "EUR",
  es: "EUR",
  se: "original",
  ch: "CHF",
};

export default function MeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isPro, state } = usePro();
  const { products, loadedCount } = useProducts();
  const p = usePreferences();
  const [picker, setPicker] = useState<
    "market" | "language" | "appearance" | null
  >(null);
  const regions = useMemo(
    () =>
      [...new Set(products.map((x) => x.region))].sort((a, b) =>
        p.regionLabel(a).localeCompare(p.regionLabel(b), p.locale),
      ),
    [p, products],
  );
  async function toggleNotifications(next: boolean) {
    if (!next) return p.setNotificationsEnabled(false);
    const granted = await requestNotificationPermission();
    await p.setNotificationsEnabled(granted);
    if (!granted)
      Alert.alert(
        p.t("me.notificationsDisabled"),
        p.t("me.notificationsDisabledBody"),
      );
  }
  const appearanceLabel = p.t(`me.appearance.${p.appearance}`);
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
            style={styles.proButton}
            onPress={() => router.push("/paywall")}
          >
            <Text style={styles.proButtonText}>
              {isPro ? p.t("me.managePro") : p.t("me.upgrade")}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.section}>{p.t("me.preferences")}</Text>
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
            value={LANGUAGE_LABELS[p.languageChoice]}
            onPress={() => setPicker("language")}
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{p.t("me.notifications")}</Text>
              <Text style={styles.rowSub}>{p.t("me.notificationsSub")}</Text>
            </View>
            <Switch
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
      </ScrollView>
      <Picker
        visible={picker === "language"}
        title={p.t("me.language")}
        value={p.languageChoice}
        options={LANGUAGE_OPTIONS.map((v) => ({
          value: v,
          label: LANGUAGE_LABELS[v],
        }))}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          void p.setLanguage(v as LanguageChoice);
          setPicker(null);
        }}
        colors={colors}
      />
      <Picker
        visible={picker === "appearance"}
        title={p.t("me.appearance")}
        value={p.appearance}
        options={(["system", "light", "dark"] as AppearancePreference[]).map(
          (v) => ({ value: v, label: p.t(`me.appearance.${v}`) }),
        )}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          void p.setAppearance(v as AppearancePreference);
          setPicker(null);
        }}
        colors={colors}
      />
      <MarketPicker
        visible={picker === "market"}
        regions={regions}
        onClose={() => setPicker(null)}
        colors={colors}
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
    <Pressable accessibilityRole="button" style={styles.row} onPress={onPress}>
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
  onClose,
  onSelect,
  colors,
}: {
  visible: boolean;
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onClose: () => void;
  onSelect: (v: string) => void;
  colors: ThemeColors;
}) {
  const s = useMemo(() => makeStyles(colors), [colors]);
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
            <Pressable style={s.close} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
          {options.map((o) => (
            <Pressable
              key={o.value}
              style={s.option}
              onPress={() => onSelect(o.value)}
            >
              <Text style={s.rowTitle}>{o.label}</Text>
              {o.value === value ? (
                <Ionicons name="checkmark" size={19} color={colors.buy} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
function MarketPicker({
  visible,
  regions,
  onClose,
  colors,
}: {
  visible: boolean;
  regions: string[];
  onClose: () => void;
  colors: ThemeColors;
}) {
  const p = usePreferences();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [region, setRegion] = useState(p.region);
  const [currency, setCurrency] = useState(p.currency);
  useEffect(() => {
    if (visible) {
      setRegion(p.region);
      setCurrency(p.currency);
    }
  }, [p.currency, p.region, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{p.t("me.market")}</Text>
            <Pressable style={s.close} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView style={s.marketList}>
            {regions.map((r) => (
              <Pressable key={r} style={s.option} onPress={() => setRegion(r)}>
                    <Text style={s.rowTitle}>{regionFlag(r)}  {p.regionLabel(r)}</Text>
                {r === region ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={19}
                    color={colors.buy}
                  />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          <Text style={s.section}>{p.t("me.currency")}</Text>
          <View style={s.chips}>
            {CURRENCY_OPTIONS.map((c) => (
              <Pressable
                key={c}
                style={[s.chip, c === currency && s.chipActive]}
                onPress={() => setCurrency(c)}
              >
                <Text style={[s.chipText, c === currency && s.chipTextActive]}>
                  {c === "original" ? p.t("me.localCurrency") : c}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.rowSub}>
            {currency === "original"
              ? `${p.t("me.localCurrency")}: ${LOCAL_CURRENCY[region] || "—"}`
              : p.rateDate
                ? p.t("me.ratesUpdated", { date: p.rateDate })
                : p.t("me.ratesUnavailable")}
          </Text>
          <Pressable
            style={s.apply}
            onPress={() => {
              void p.setMarket({ region, currency });
              onClose();
            }}
          >
            <Text style={s.applyText}>{p.t("common.done")}</Text>
          </Pressable>
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
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    card: {
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
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
    marketList: { maxHeight: 300 },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginVertical: 10,
    },
    chip: {
      minHeight: 44,
      justifyContent: "center",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.borderStrong,
      paddingHorizontal: 12,
    },
    chipActive: { backgroundColor: c.pill },
    chipText: { color: c.ink, fontWeight: "800" },
    chipTextActive: { color: c.onPill },
    apply: {
      minHeight: 52,
      marginTop: 16,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: c.pill,
    },
    applyText: { color: c.onPill, fontSize: 15, fontWeight: "900" },
  });
}
