import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../contexts/ThemeContext";
import {
  defaultImageKind,
  type DefaultImageKind,
} from "../lib/defaultImage";
import type { ThemeColors } from "../lib/theme";

export { defaultImageKind };
export type { DefaultImageKind };

type Props = {
  category?: string | null;
  brand?: string | null;
  compact?: boolean;
};

const silhouettes: Record<DefaultImageKind, string> = {
  jacket:
    "M47 28 35 34 18 75l13 7 13-28v42h32V54l13 28 13-7-17-41-12-6 M48 28c0-10 5-16 12-16s12 6 12 16L66 39H54L48 28Z M60 39v57 M49 67l8 6m14-6-8 6",
  fleece:
    "M48 28 36 34 18 76l13 7 14-29v42h30V54l14 29 13-7-18-42-12-6 M51 27v11h18V27 M51 27c3 5 15 5 18 0 M60 38v25 M47 68h26l-4 13H51l-4-13",
  pants: "M43 23h34l4 68H64l-4-43-4 43H39l4-68Z M43 36h34",
  overall:
    "M43 37h34l4 55H64l-4-37-4 37H39l4-55Z M48 37V22h8v15m8 0V22h8v15 M48 22h24",
  shirt:
    "M38 31 50 23h20l12 8 14 20-13 8-8-12v45H45V47l-8 12-13-8 14-20Z M51 24c1 8 17 8 18 0",
  swim: "M39 25h42l-5 27-16 7-16-7-5-27Z M44 52l-5 40h17l4-33 4 33h17l-5-40",
  beanie: "M35 58c0-22 11-36 25-36s25 14 25 36 M31 58h58v18H31Z M60 22v-8",
  shoes:
    "M24 67c12 2 20-5 25-18l14 13 25 8c7 2 9 11 2 15H31c-13 0-17-12-7-18Z M28 72h61",
  bag: "M31 40h58l-3 51H34l-3-51Z M45 40c0-18 30-18 30 0 M41 55h38",
  snowboard:
    "M55 12c-8 0-13 7-13 16v64c0 10 7 16 18 16s18-6 18-16V28c0-9-5-16-13-16H55Z M45 42h30M45 79h30",
  other: "M60 18 91 36v48L60 102 29 84V36L60 18Z M29 36l31 18 31-18M60 54v48",
};

export function DefaultImage({ category, brand, compact = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const kind = defaultImageKind(category);
  return (
    <View style={styles.wrap} accessibilityElementsHidden>
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox="0 0 120 120"
        preserveAspectRatio="none"
      >
        <Path
          d="M-18 38C8 12 28 66 54 40S94 8 138 35M-14 56C14 28 33 82 61 55S105 25 140 52M-12 76C16 47 39 99 68 73s45-30 74-4M-9 96c27-27 51 20 80-3s44-28 71-6"
          fill="none"
          stroke={colors.photoTopo}
          strokeWidth="1.5"
        />
      </Svg>
      <Svg
        width={compact ? "58%" : "48%"}
        height={compact ? "58%" : "48%"}
        viewBox="0 0 120 120"
      >
        <Path
          d={silhouettes[kind]}
          fill="none"
          stroke="#34383C"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      {!compact && brand ? (
        <Text style={styles.brand} numberOfLines={1}>
          {brand}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      backgroundColor: colors.photo,
    },
    brand: {
      position: "absolute",
      left: 9,
      bottom: 8,
      maxWidth: "76%",
      color: "#34383C",
      fontSize: 9.5,
      fontWeight: "900",
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
  });
