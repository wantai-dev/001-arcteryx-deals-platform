import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { ThemeColors } from '../lib/theme';

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
  return (
    <View style={styles.wrap}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionPressed]} onPress={onAction} accessibilityRole="button">
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
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
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
  actionText: { color: colors.surface, fontSize: 14, fontWeight: '800' },
}); }
