import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Sheet } from "./Sheet";

import { useTheme } from "../contexts/ThemeContext";
import { radii, text, typography, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";

export type FilterSheetSection = {
  key: string;
  title: string;
  options: Array<{ value: string; label: string }>;
  value: string;
};

type Props = {
  visible: boolean;
  title: string;
  sections: FilterSheetSection[];
  resultLabel: string;
  resetLabel: string;
  closeLabel: string;
  onSelect: (section: string, value: string) => void;
  onReset: () => void;
  onClose: () => void;
};

export function FilterSheet({
  visible,
  title,
  sections,
  resultLabel,
  resetLabel,
  closeLabel,
  onSelect,
  onReset,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      detents={[0.55, 0.9]}
      closeAccessibilityLabel={closeLabel}
      style={styles.sheet}
    >
      <View style={styles.inner}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={styles.close}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator
          >
            {sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={styles.chips}>
                  {section.options.map((option) => {
                    const active = section.value === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.chip,
                          { minHeight: scaleLength(44, fontScale) },
                          active && styles.chipActive,
                        ]}
                        onPress={() => onSelect(section.key, option.value)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                          ]}
                          numberOfLines={2}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={resetLabel}
              style={[styles.reset, { minHeight: scaleLength(52, fontScale) }]}
              onPress={onReset}
            >
              <Text style={styles.resetText}>{resetLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={resultLabel}
              style={[styles.done, { minHeight: scaleLength(52, fontScale) }]}
              onPress={onClose}
            >
              <Text style={styles.doneText}>{resultLabel}</Text>
            </Pressable>
          </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: { backgroundColor: colors.card },
    inner: { flex: 1, gap: 16, padding: 18, paddingTop: 6, paddingBottom: 12 },
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
    content: { gap: 20, paddingBottom: 4 },
    section: { gap: 9 },
    sectionTitle: { ...text.footnoteEmphasized, color: colors.ink2 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      minHeight: 44,
      minWidth: 44,
      maxWidth: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipActive: { borderColor: colors.pill, backgroundColor: colors.pill },
    chipText: { ...text.footnote, color: colors.ink2 },
    chipTextActive: { color: colors.onPill },
    actions: { flexDirection: "row", gap: 10 },
    reset: {
      minHeight: 52,
      minWidth: 86,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      paddingHorizontal: 14,
    },
    resetText: { ...text.subheadEmphasized, color: colors.ink },
    done: {
      minHeight: 52,
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.pill,
      paddingHorizontal: 14,
    },
    doneText: {
      ...text.subheadEmphasized,
      color: colors.onPill,
      fontFamily: typography.mono,
    },
  });
