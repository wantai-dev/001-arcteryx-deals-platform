import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import type { ThemeColors } from "../lib/theme";

type Props = {
  value: string;
  placeholder: string;
  accessibilityLabel?: string;
  clearAccessibilityLabel: string;
  onChangeText: (value: string) => void;
};

export function SearchField({
  value,
  placeholder,
  accessibilityLabel = placeholder,
  clearAccessibilityLabel,
  onChangeText,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.root}>
      <Ionicons name="search" size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          style={styles.clear}
          onPress={() => onChangeText("")}
        >
          <Ionicons name="close-circle" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingLeft: 12,
    },
    input: {
      minWidth: 0,
      flex: 1,
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 0,
    },
    clear: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  });
