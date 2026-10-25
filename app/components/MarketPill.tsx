import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { regionFlag } from "../lib/catalog";
import { text, typography, type ThemeColors } from "../lib/theme";
import { scaleLength, TYPE_CAP } from "../lib/typeScale";

export function MarketPill({
  region,
  currency,
  label,
  onPress,
}: {
  region: string;
  currency: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.pill, { minHeight: scaleLength(44, fontScale) }]}
      onPress={onPress}
    >
      <Text style={styles.flag} maxFontSizeMultiplier={TYPE_CAP.badge}>
        {regionFlag(region)}
      </Text>
      <Text
        style={styles.label}
        numberOfLines={1}
        maxFontSizeMultiplier={TYPE_CAP.badge}
      >
        {region === "all" ? "ALL" : region.toUpperCase()} ·{" "}
        {currency === "original" ? "LOCAL" : currency}
      </Text>
      <Ionicons
        name="chevron-down"
        size={scaleLength(12, fontScale, { max: 1.4 })}
        color={colors.ink}
      />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    pill: {
      // The pill sits beside a logo or a nav title, so it yields space rather
      // than pushing them off screen at the larger text sizes.
      minWidth: 0,
      flexShrink: 1,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
      paddingHorizontal: 11,
    },
    flag: { fontSize: 15 },
    label: {
      ...text.caption2Emphasized,
      minWidth: 0,
      flexShrink: 1,
      color: colors.ink,
      fontFamily: typography.mono,
    },
  });
