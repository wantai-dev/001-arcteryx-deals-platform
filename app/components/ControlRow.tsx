import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useTheme } from "../contexts/ThemeContext";
import { text, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";

type Props = {
  sortLabel: string;
  filterLabel: string;
  filterCount: number;
  onSort: () => void;
  onFilter: () => void;
};

export function ControlRow({
  sortLabel,
  filterLabel,
  filterCount,
  onSort,
  onFilter,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  const control = scaleLength(44, fontScale, { max: 1.4 });
  return (
    <View style={[styles.row, { minHeight: control }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sortLabel}
        style={[styles.sort, { minHeight: control }]}
        onPress={onSort}
      >
        <Text style={styles.sortText} numberOfLines={1}>
          {sortLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${filterLabel}, ${filterCount}`}
        style={[styles.filter, { width: control, height: control }]}
        onPress={onFilter}
      >
        <Ionicons name="options-outline" size={19} color={colors.ink} />
        {filterCount > 0 ? (
          <View style={styles.count}>
            <Text style={styles.countText}>{filterCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sort: {
      minHeight: 44,
      maxWidth: "78%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    sortText: { ...text.footnoteEmphasized, color: colors.ink },
    filter: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.card,
    },
    count: {
      position: "absolute",
      right: -4,
      top: -4,
      minWidth: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.screen,
      backgroundColor: colors.disc,
      paddingHorizontal: 3,
    },
    countText: { ...text.caption2Emphasized, fontSize: 10, lineHeight: 12, color: "#fff" },
  });
