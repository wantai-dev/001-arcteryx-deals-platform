import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { radii, type ThemeColors } from '../lib/theme';

export function ProGate({ title, subtitle, action = 'Pro' }: { title: string; subtitle: string; action?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.row}><Ionicons name="lock-closed-outline" size={18} color={colors.ink2} /><View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={action} style={styles.button} onPress={() => router.push('/paywall')}><Text style={styles.buttonText}>{action}</Text></Pressable></View>;
}
function createStyles(c: ThemeColors) { return StyleSheet.create({ row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, backgroundColor: c.screen, padding: 12 }, copy: { flex: 1 }, title: { color: c.ink, fontSize: 14, fontWeight: '900' }, subtitle: { color: c.muted, marginTop: 3, fontSize: 12, lineHeight: 16 }, button: { minWidth: 58, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.pill, paddingHorizontal: 10 }, buttonText: { color: c.onPill, fontWeight: '900' } }); }
