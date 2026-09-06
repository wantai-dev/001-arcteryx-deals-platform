import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLogo } from "../components/BrandLogo";
import { usePreferences } from "../contexts/PreferencesContext";
import { usePro } from "../contexts/ProContext";
import { useTheme } from "../contexts/ThemeContext";
import { ProPlan, ProPlanId } from "../lib/iap";
import { ThemeColors, radii, typography } from "../lib/theme";

const TERMS_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://geardrop.100app.dev/privacy.html";
export const PRO_FEATURES = [
  { title: "paywall.priceHistory", detail: "paywall.priceHistoryDetail", shipped: true },
  { title: "paywall.lowSignal", detail: "paywall.lowSignalDetail", shipped: true },
  { title: "paywall.alerts", detail: "paywall.alertsDetail", shipped: false },
] as const;
const visibleFeatures = PRO_FEATURES.filter((feature) => feature.shipped || __DEV__);
export default function PaywallScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = usePreferences();
  const { isPro, plans, state, busyPlan, purchase, restore, redeemOfferCode, refresh } =
    usePro();
  const [selectedId, setSelectedId] = useState<ProPlanId>("annual");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (plans.length && !plans.some((p) => p.id === selectedId))
      setSelectedId(plans.find((p) => p.id === "annual")?.id || plans[0]!.id);
  }, [plans, selectedId]);
  const selected = plans.find((p) => p.id === selectedId) || null;
  async function buy() {
    if (isPro) return router.back();
    if (!selected) return;
    setNotice(null);
    const result = await purchase(selected.id);
    if (result === "purchased") router.back();
    else if (result === "pending") setNotice(t("paywall.pending"));
    else if (result !== "cancelled") setNotice(t("paywall.purchaseFailed"));
  }
  async function handleRestore() {
    setNotice(null);
    setNotice(
      (await restore()) === "restored"
        ? t("paywall.restored")
        : t("paywall.nothingToRestore"),
    );
  }
  async function handleRedeemOfferCode() {
    setNotice(null);
    setNotice(await redeemOfferCode() === "presented" ? t("paywall.redeemPresented") : t("paywall.redeemUnavailable"));
  }
  const benefits = visibleFeatures.map((feature) => [t(feature.title), t(feature.detail)]);
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <BrandLogo markOnly style={styles.brandMark} />
          <Text style={styles.kicker}>{t("paywall.kicker")}</Text>
          <Pressable
            accessibilityLabel={t("common.cancel")}
            style={styles.close}
            onPress={() => router.back()}
          >
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.title}>{t('paywall.title')}</Text>
        <Text style={styles.subtitle}>{t("paywall.subtitle")}</Text>
        <View style={styles.benefits}>
          {benefits.map(([title, detail]) => (
            <View key={title} style={styles.benefit}>
              <View style={styles.benefitIcon}>
                <Ionicons name="checkmark" size={16} color={colors.buy} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.benefitTitle}>{title}</Text>
                <Text style={styles.benefitDetail}>{detail}</Text>
              </View>
            </View>
          ))}
        </View>
        {isPro ? (
          <View style={styles.active}>
            <Ionicons name="checkmark-circle" size={20} color={colors.buy} />
            <Text style={styles.activeText}>{t("paywall.proActive")}</Text>
          </View>
        ) : state === "loading" ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.muted}>{t("paywall.loadingPlans")}</Text>
          </View>
        ) : plans.length ? (
          <View style={styles.plans}>
            {plans.map((plan) => (
              <Plan
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedId}
                onPress={() => setSelectedId(plan.id)}
                colors={colors}
                styles={styles}
                t={t}
              />
            ))}
          </View>
        ) : (
          <View style={styles.loading}>
            <Text style={styles.muted}>{t("paywall.unavailable")}</Text>
            <Pressable style={styles.retry} onPress={() => void refresh()}>
              <Text style={styles.retryText}>{t("paywall.retry")}</Text>
            </Pressable>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(busyPlan) || (!isPro && !selected)}
          style={[
            styles.cta,
            (busyPlan || (!isPro && !selected)) && styles.disabled,
          ]}
          onPress={() => void buy()}
        >
          {busyPlan && busyPlan !== "restore" ? (
            <ActivityIndicator color={colors.onPill} />
          ) : null}
          <Text style={styles.ctaText}>
            {isPro
              ? t("paywall.proActive")
              : t("paywall.continue", {
                  plan: selected ? label(selected.id, t) : "",
                })}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(busyPlan)}
          style={styles.restore}
          onPress={() => void handleRestore()}
        >
          {busyPlan === "restore" ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : null}
          <Text style={styles.restoreText}>
            {busyPlan === "restore"
              ? t("paywall.restoring")
              : t("paywall.restore")}
          </Text>
        </Pressable>
        {!isPro ? <Pressable accessibilityRole="button" disabled={Boolean(busyPlan)} style={styles.restore} onPress={() => void handleRedeemOfferCode()}><Text style={styles.restoreText}>{t('paywall.redeemCode')}</Text></Pressable> : null}
        {notice ? (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
        <Text style={styles.fine}>
          {selected?.id === "lifetime"
            ? t("paywall.lifetimeTerms")
            : t("paywall.renewalTerms")}
        </Text>
        <View style={styles.links}>
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)}
          >
            <Text style={styles.link}>{t("paywall.terms")}</Text>
          </Pressable>
          <Text style={styles.muted}>·</Text>
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}
          >
            <Text style={styles.link}>{t("paywall.privacy")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function label(id: ProPlanId, t: ReturnType<typeof usePreferences>["t"]) {
  return t(
    id === "monthly"
      ? "paywall.planMonthly"
      : id === "annual"
        ? "paywall.planAnnual"
        : "paywall.planLifetime",
  );
}
function Plan({
  plan,
  selected,
  onPress,
  colors,
  styles,
  t,
}: {
  plan: ProPlan;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  t: ReturnType<typeof usePreferences>["t"];
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[styles.plan, selected && styles.selected]}
      onPress={onPress}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={colors.ink}
      />
      <View style={styles.flex}>
        <View style={styles.planHead}>
          <Text style={styles.planTitle}>{label(plan.id, t)}</Text>
          {plan.id === "annual" ? (
            <Text style={styles.best}>{t("paywall.bestValue")}</Text>
          ) : null}
          {plan.trialDays ? (
            <Text style={styles.trial}>
              {t("paywall.trialDays", { count: plan.trialDays })}
            </Text>
          ) : null}
        </View>
        {plan.id === "annual" && plan.pricePerMonth ? (
          <Text style={styles.planSub}>
            {t("paywall.perMonth", { price: plan.pricePerMonth })}
          </Text>
        ) : null}
      </View>
      <Text style={styles.price}>{plan.price}</Text>
    </Pressable>
  );
}
function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { padding: 22, paddingBottom: 38 },
    top: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    kicker: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.2,
    },
    brandMark: { width: 27, height: 27 },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      maxWidth: 320,
      color: c.ink,
      marginTop: 14,
      fontSize: 32,
      lineHeight: 37,
      fontWeight: "900",
    },
    subtitle: { color: c.muted, marginTop: 10, fontSize: 14, lineHeight: 21 },
    benefits: { gap: 14, marginVertical: 26 },
    benefit: { flexDirection: "row", gap: 12, alignItems: "center" },
    benefitIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: c.buyBg,
      alignItems: "center",
      justifyContent: "center",
    },
    benefitTitle: { color: c.ink, fontSize: 15, fontWeight: "800" },
    benefitDetail: {
      color: c.muted,
      marginTop: 2,
      fontSize: 12,
      lineHeight: 17,
    },
    flex: { flex: 1 },
    plans: { gap: 9, marginTop: 12 },
    plan: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 14,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.card,
    },
    selected: { borderColor: c.ink, borderWidth: 2 },
    planHead: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    planTitle: { color: c.ink, fontSize: 14, fontWeight: "900" },
    best: {
      color: c.onPill,
      backgroundColor: c.buy,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      overflow: "hidden",
      fontSize: 10,
      fontWeight: "900",
    },
    trial: { color: c.buy, fontSize: 10, fontWeight: "800" },
    planSub: { color: c.muted, marginTop: 3, fontSize: 11 },
    price: {
      color: c.ink,
      fontFamily: typography.mono,
      fontVariant: typography.tabular,
      fontSize: 16,
      fontWeight: "900",
    },
    cta: {
      minHeight: 52,
      marginTop: 18,
      borderRadius: 12,
      backgroundColor: c.pill,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 7,
    },
    ctaText: { color: c.onPill, fontSize: 15, fontWeight: "900" },
    disabled: { opacity: 0.45 },
    restore: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 7,
    },
    restoreText: { color: c.ink, fontSize: 13, fontWeight: "800" },
    loading: {
      minHeight: 90,
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: c.card,
      padding: 14,
    },
    muted: { color: c.muted, textAlign: "center" },
    retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 15 },
    retryText: { color: c.ink, fontWeight: "800" },
    active: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 12,
      backgroundColor: c.card,
    },
    activeText: { color: c.buy, fontWeight: "900" },
    notice: {
      color: c.buy,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "800",
    },
    fine: {
      color: c.muted,
      marginTop: 8,
      textAlign: "center",
      fontSize: 11,
      lineHeight: 16,
    },
    links: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    link: { color: c.ink2, textDecorationLine: "underline", fontSize: 12 },
  });
}
