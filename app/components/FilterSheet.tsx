import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { radii, typography, type ThemeColors } from "../lib/theme";

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
  onSelect,
  onReset,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
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
                        style={[styles.chip, active && styles.chipActive]}
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
            <Pressable style={styles.reset} onPress={onReset}>
              <Text style={styles.resetText}>{resetLabel}</Text>
            </Pressable>
            <Pressable style={styles.done} onPress={onClose}>
              <Text style={styles.doneText}>{resultLabel}</Text>
            </Pressable>
          </View>
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
      gap: 16,
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
    content: { gap: 20, paddingBottom: 4 },
    section: { gap: 9 },
    sectionTitle: { color: colors.ink2, fontSize: 12, fontWeight: "800" },
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
    chipText: { color: colors.ink2, fontSize: 12, fontWeight: "700" },
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
    resetText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
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
      color: colors.onPill,
      fontFamily: typography.mono,
      fontSize: 13,
      fontWeight: "900",
    },
  });
