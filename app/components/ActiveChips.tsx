import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { radii, type ThemeColors } from "../lib/theme";

export type ActiveChip = { key: string; label: string; onRemove: () => void };

export function ActiveChips({ chips }: { chips: ActiveChip[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!chips.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
          hitSlop={4}
          style={styles.chip}
          onPress={chip.onRemove}
        >
          <Text style={styles.text} numberOfLines={1}>
            {chip.label}
          </Text>
          <Ionicons name="close" size={13} color={colors.disc} />
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
    text: { color: colors.disc, fontSize: 11.5, fontWeight: "800" },
  });
