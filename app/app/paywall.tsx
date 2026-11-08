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
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLogo } from "../components/BrandLogo";
import { usePreferences } from "../contexts/PreferencesContext";
import { usePro } from "../contexts/ProContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  ProPlan,
  ProPlanId,
  ProPurchaseConcernResult,
  purchaseConcern,
  resolveRestoreFeedback,
} from "../lib/iap";
import { radii, text, typography, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";

const TERMS_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://geardrop.100app.dev/privacy.html";
export const PRO_FEATURES = [
  { title: "paywall.priceHistory", detail: "paywall.priceHistoryDetail" },
  { title: "paywall.alerts", detail: "paywall.alertsDetail" },
  { title: "paywall.watchlist", detail: "paywall.watchlistDetail" },
] as const;
export default function PaywallScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const { t } = usePreferences();
  const { isPro, plans, state, busyPlan, purchase, restore, redeemOfferCode, refresh } =
    usePro();
  const [selectedId, setSelectedId] = useState<ProPlanId>("annual");
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseConcernResult, setPurchaseConcernResult] = useState<ProPurchaseConcernResult | null>(null);
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
    const concern = purchaseConcern(result);
    setPurchaseConcernResult(concern);
    if (result.outcome === "purchased") router.back();
    else if (result.outcome !== "cancelled") setNotice(purchaseNotice(result.outcome, result.code, t));
  }
  async function handleRestore() {
    setNotice(null);
    const outcome = await restore();
    const feedback = resolveRestoreFeedback(purchaseConcernResult, outcome);
    setPurchaseConcernResult(feedback.concern);
    setNotice(feedback.notice === "restored"
      ? t("paywall.restored")
      : feedback.notice === "failed"
        ? t("paywall.restoreFailed")
        : feedback.notice === "not_found"
          ? t("paywall.nothingToRestore")
          : purchaseNotice(feedback.notice, feedback.concern?.code, t, true));
  }
  async function handleRedeemOfferCode() {
    setNotice(null);
    setNotice(await redeemOfferCode() === "presented" ? t("paywall.redeemPresented") : t("paywall.redeemUnavailable"));
  }
  const benefits = PRO_FEATURES.map((feature) => [t(feature.title), t(feature.detail)]);
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
          disabled={Boolean(busyPlan) || Boolean(purchaseConcernResult) || (!isPro && !selected)}
          style={[
            styles.cta,
            { minHeight: scaleLength(52, fontScale) },
            (busyPlan || purchaseConcernResult || (!isPro && !selected)) && styles.disabled,
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
          style={[styles.restore, { minHeight: scaleLength(44, fontScale) }]}
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
function purchaseNotice(
  outcome: string,
  code: string | undefined,
  t: ReturnType<typeof usePreferences>["t"],
  afterRestore = false,
) {
  const key = outcome === "pending"
    ? "paywall.pending"
    : outcome === "missing_entitlement"
      ? afterRestore ? "paywall.purchaseStillSyncing" : "paywall.purchaseSyncing"
      : outcome === "store_unavailable"
        ? afterRestore ? "paywall.storeStillUnconfirmed" : "paywall.storeUnavailable"
        : outcome === "network_error"
          ? "paywall.purchaseNetworkError"
          : outcome === "purchase_restricted"
            ? "paywall.purchaseRestricted"
            : "paywall.purchaseFailed";
  const message = t(key);
  return code ? `${message} ${t("paywall.referenceCode", { code })}` : message;
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
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[
        styles.plan,
        { minHeight: scaleLength(66, fontScale) },
        selected && styles.selected,
      ]}
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
      ...text.caption2Emphasized,
      color: c.muted,
      letterSpacing: 1.1,
    },
    brandMark: { width: 27, height: 27 },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      ...text.largeTitle,
      maxWidth: 320,
      color: c.ink,
      marginTop: 14,
    },
    subtitle: { ...text.subhead, color: c.muted, marginTop: 10 },
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
    benefitTitle: { ...text.subheadEmphasized, color: c.ink },
    benefitDetail: {
      ...text.footnote,
      color: c.muted,
      marginTop: 2,
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
    planTitle: { ...text.subheadEmphasized, color: c.ink },
    best: {
      ...text.caption2Emphasized,
      color: c.onPill,
      backgroundColor: c.buy,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      overflow: "hidden",
    },
    trial: { ...text.caption2Emphasized, color: c.buy },
    planSub: { ...text.caption1, color: c.muted, marginTop: 3 },
    price: {
      ...text.calloutEmphasized,
      color: c.ink,
      fontFamily: typography.mono,
      fontVariant: typography.tabular,
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
    ctaText: { ...text.headline, color: c.onPill },
    disabled: { opacity: 0.45 },
    restore: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 7,
    },
    restoreText: { ...text.footnoteEmphasized, color: c.ink },
    loading: {
      minHeight: 90,
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: c.card,
      padding: 14,
    },
    muted: { ...text.subhead, color: c.muted, textAlign: "center" },
    retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 15 },
    retryText: { ...text.subheadEmphasized, color: c.ink },
    active: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 12,
      backgroundColor: c.card,
    },
    activeText: { ...text.headline, color: c.buy },
    notice: {
      ...text.footnoteEmphasized,
      color: c.buy,
      textAlign: "center",
    },
    fine: {
      ...text.caption1,
      color: c.muted,
      marginTop: 8,
      textAlign: "center",
    },
    links: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    link: { ...text.footnote, color: c.ink2, textDecorationLine: "underline" },
  });
}
