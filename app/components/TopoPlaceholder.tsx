import { StyleSheet, View } from "react-native";

import { DefaultImage } from "./DefaultImage";
import { radii } from "../lib/theme";

type Props = {
  label?: string;
  showLabel?: boolean;
  category?: string;
  brand?: string;
  compact?: boolean;
};

export function TopoPlaceholder({
  label = "Gear",
  showLabel = true,
  category,
  brand,
  compact,
}: Props) {
  return (
    <View style={styles.wrap}>
      <DefaultImage
        category={category || label}
        brand={showLabel ? brand || label : brand}
        compact={compact}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    overflow: "hidden",
    borderRadius: radii.lg,
  },
});
