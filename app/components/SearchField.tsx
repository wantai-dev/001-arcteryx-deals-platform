import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { text, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";

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
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.root, { minHeight: scaleLength(44, fontScale) }]}>
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
      ...text.body,
      minWidth: 0,
      flex: 1,
      color: colors.ink,
      paddingVertical: 0,
    },
    clear: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  });
