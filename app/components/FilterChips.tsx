import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Sheet } from "./Sheet";

import { usePreferences } from "../contexts/PreferencesContext";
import { useTheme } from "../contexts/ThemeContext";
import {
  BRAND,
  BRAND_OPTIONS,
  CATEGORY_ORDER,
  GENDER_OPTIONS,
  PLATFORM,
  SORT_OPTIONS,
} from "../lib/catalog";
import { browseText } from "../lib/browseI18n";
import type { DealFilters } from "../lib/deals";
import { radii, text, type ThemeColors } from "../lib/theme";
import { scaleLength } from "../lib/typeScale";
import { ControlRow } from "./ControlRow";
import { ActiveChips } from "./ActiveChips";
import { FilterSheet, type FilterSheetSection } from "./FilterSheet";

type Props = {
  value: DealFilters;
  brands: string[];
  platforms: string[];
  categories: string[];
  series?: string[];
  resultCount?: number;
  lowScanPending?: boolean;
  onChange: (next: Partial<DealFilters>) => void;
};

export function FilterChips({
  value,
  brands,
  platforms,
  categories,
  resultCount = 0,
  lowScanPending = false,
  onChange,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categoryLabel, genderLabel, language, t } = usePreferences();
  const b = (
    key: Parameters<typeof browseText>[1],
    params?: Record<string, string | number>,
  ) => browseText(language, key, params);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const availableBrands = useMemo(() => new Set(brands), [brands]);
  const sortedCategories = useMemo(
    () =>
      categories.slice().sort((a, c) => {
        const ai = CATEGORY_ORDER.indexOf(a);
        const ci = CATEGORY_ORDER.indexOf(c);
        return (ai < 0 ? 999 : ai) - (ci < 0 ? 999 : ci) || a.localeCompare(c);
      }),
    [categories],
  );
  const active = [
    value.brand !== "all"
      ? {
          key: "brand",
          label: BRAND[value.brand as keyof typeof BRAND]?.label || value.brand,
          clear: { brand: "all" },
        }
      : null,
    value.platform !== "all"
      ? {
          key: "platform",
          label: PLATFORM[value.platform]?.label || value.platform,
          clear: { platform: "all" },
        }
      : null,
    value.category !== "all"
      ? {
          key: "category",
          label: categoryLabel(value.category),
          clear: { category: "all" },
        }
      : null,
    value.gender !== "all"
      ? {
          key: "gender",
          label: genderLabel(value.gender),
          clear: { gender: "all" },
        }
      : null,
    (value.minDiscount ?? 0) > 0
      ? {
          key: "discount",
          label: value.minDiscount === 50 ? b("fiftyOff") : b("thirtyOff"),
          clear: { minDiscount: 0 },
        }
      : null,
    value.lowOnly
      ? {
          key: "lowOnly",
          label: lowScanPending ? b("loadingLows") : b("lowsOnly"),
          clear: { lowOnly: false },
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    clear: Partial<DealFilters>;
  }>;

  const sections: FilterSheetSection[] = [
    {
      key: "brand",
      title: b("brand"),
      value: value.brand,
      options: BRAND_OPTIONS.filter(
        (option) => option === "all" || availableBrands.has(option),
      ).map((option) => ({
        value: option,
        label:
          option === "all"
            ? b("allBrands")
            : BRAND[option as keyof typeof BRAND]?.label || option,
      })),
    },
    {
      key: "platform",
      title: b("source"),
      value: value.platform,
      options: ["all", ...platforms.slice().sort()].map((option) => ({
        value: option,
        label:
          option === "all"
            ? b("allSources")
            : PLATFORM[option]?.label || option,
      })),
    },
    {
      key: "category",
      title: b("category"),
      value: value.category,
      options: ["all", ...sortedCategories].map((option) => ({
        value: option,
        label: option === "all" ? b("allCategories") : categoryLabel(option),
      })),
    },
    {
      key: "gender",
      title: b("gender"),
      value: value.gender,
      options: GENDER_OPTIONS.map((option) => ({
        value: option,
        label: option === "all" ? b("allGenders") : genderLabel(option),
      })),
    },
    {
      key: "minDiscount",
      title: b("discount"),
      value: String(value.minDiscount ?? 0),
      options: [
        { value: "0", label: b("anyDiscount") },
        { value: "30", label: b("thirtyOff") },
        { value: "50", label: b("fiftyOff") },
      ],
    },
    {
      key: "lowOnly",
      title: b("lowsOnly"),
      value: value.lowOnly ? "true" : "false",
      options: [
        { value: "false", label: b("anyDiscount") },
        { value: "true", label: b("lowsOnly") },
      ],
    },
  ];

  return (
    <View style={styles.wrap}>
      <ControlRow
        sortLabel={`${b("sort")} · ${t(`sort.${value.sort}`)}`}
        filterLabel={b("filters")}
        filterCount={active.length}
        onSort={() => setSortOpen(true)}
        onFilter={() => setFilterOpen(true)}
      />
      <ActiveChips
        chips={active.map((chip) => ({
          key: chip.key,
          label: chip.label,
          onRemove: () => onChange(chip.clear),
        }))}
      />
      <SortSheet
        visible={sortOpen}
        value={value.sort}
        title={b("sort")}
        closeLabel={b("close")}
        getLabel={(option) => t(`sort.${option}`)}
        onSelect={(sort) => {
          onChange({ sort });
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
      <FilterSheet
        visible={filterOpen}
        title={b("filters")}
        sections={sections}
        resultLabel={b("viewResults", { count: resultCount })}
        resetLabel={b("reset")}
        closeLabel={b("close")}
        onSelect={(key, next) => {
          if (key === "minDiscount")
            onChange({ minDiscount: Number(next) as 0 | 30 | 50 });
          else if (key === "lowOnly") onChange({ lowOnly: next === "true" });
          else onChange({ [key]: next });
        }}
        onReset={() =>
          onChange({
            brand: "all",
            platform: "all",
            category: "all",
            gender: "all",
            series: "all",
            minDiscount: 0,
            lowOnly: false,
          })
        }
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}

function SortSheet({
  visible,
  value,
  title,
  closeLabel,
  getLabel,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  title: string;
  closeLabel: string;
  getLabel: (value: string) => string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={closeLabel}
      style={styles.sheet}
    >
      <View style={styles.sortSheet}>
          <View style={styles.sortHead}>
            <Text style={styles.sortTitle}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={styles.close}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color={colors.ink} />
            </Pressable>
          </View>
          {SORT_OPTIONS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={getLabel(option)}
              accessibilityState={{ checked: option === value }}
              style={[styles.sortOption, { minHeight: scaleLength(52, fontScale) }]}
              onPress={() => onSelect(option)}
            >
              <Text
                style={[
                  styles.sortOptionText,
                  option === value && styles.sortOptionActive,
                ]}
              >
                {getLabel(option)}
              </Text>
              {option === value ? (
                <Ionicons name="checkmark" size={18} color={colors.buy} />
              ) : null}
            </Pressable>
          ))}
      </View>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 7 },
    sheet: { backgroundColor: colors.card },
    sortSheet: { gap: 2, padding: 18, paddingTop: 6, paddingBottom: 12 },
    sortHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sortTitle: { ...text.title3, color: colors.ink },
    close: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    sortOption: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sortOptionText: { ...text.body, color: colors.ink2 },
    sortOptionActive: { color: colors.ink, fontWeight: "600" },
  });
