import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { radii, text, type ThemeColors } from "../lib/theme";
import { scaleLength, TYPE_CAP } from "../lib/typeScale";

export type ActiveChip = { key: string; label: string; onRemove: () => void };

export function ActiveChips({ chips }: { chips: ActiveChip[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const chipHeight = scaleLength(36, fontScale);
  if (!chips.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, { minHeight: chipHeight }]}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
          hitSlop={4}
          style={[styles.chip, { minHeight: chipHeight }]}
          onPress={chip.onRemove}
        >
          <Text
            style={styles.text}
            numberOfLines={1}
            maxFontSizeMultiplier={TYPE_CAP.compact}
          >
            {chip.label}
          </Text>
          <Ionicons
            name="close"
            size={scaleLength(13, fontScale, { max: 1.5 })}
            color={colors.disc}
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: { minHeight: 36, gap: 7, paddingRight: 4 },
    chip: {
      minHeight: 36,
      maxWidth: 190,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.discLine,
      backgroundColor: colors.discBg,
      paddingHorizontal: 9,
    },
    text: { ...text.caption2Emphasized, color: colors.disc },
  });
