import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { text, type ThemeColors } from '../lib/theme';
import { scaleLength } from '../lib/typeScale';

type Props = {
  title?: string;
  body?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function ScreenState({ title = 'Loading', body, loading = false, actionLabel, onAction }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.wrap}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={({ pressed }) => [styles.action, { minHeight: scaleLength(44, fontScale) }, pressed && styles.actionPressed]} onPress={onAction} accessibilityRole="button">
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) { return StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: colors.bg,
  },
  title: {
    ...text.headline,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    ...text.subhead,
    color: colors.muted,
    textAlign: 'center',
  },
  action: {
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.ink,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  actionPressed: { opacity: 0.78 },
  actionText: { ...text.subheadEmphasized, color: colors.surface },
}); }
