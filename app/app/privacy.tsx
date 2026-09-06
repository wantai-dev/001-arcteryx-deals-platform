import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLogo } from '../components/BrandLogo';
import { usePreferences } from '../contexts/PreferencesContext';
import { openSupportUrl } from '../lib/actions';
import { useTheme } from '../contexts/ThemeContext';
import { ThemeColors, radii } from '../lib/theme';

export default function PrivacyScreen() {
  const { t } = usePreferences();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.nav}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandLogo style={styles.brandLogo} />
        <Text style={styles.title}>{t('privacy.title')}</Text>
        <PolicyBlock
          title={t('privacy.storeTitle')}
          body={t('privacy.storeBody')} styles={styles}
        />
        <PolicyBlock
          title={t('privacy.readTitle')}
          body={t('privacy.readBody')} styles={styles}
        />
        <PolicyBlock
          title={t('privacy.notificationsTitle')}
          body={t('privacy.notificationsBody')} styles={styles}
        />
        <PolicyBlock
          title={t('privacy.purchasesTitle')}
          body={t('privacy.purchasesBody')} styles={styles}
        />
        <PolicyBlock
          title={t('privacy.contactTitle')}
          body={t('privacy.contactBody')} styles={styles}
        />
        <Pressable accessibilityRole="link" style={styles.supportButton} onPress={openSupportUrl}>
          <Text style={styles.supportButtonText}>{t('privacy.openSupport')}</Text>
          <Ionicons name="open-outline" size={18} color={colors.onPill} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function PolicyBlock({ title, body, styles }: { title: string; body: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      <Text style={styles.blockBody}>{body}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  nav: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  content: {
    gap: 14,
    padding: 20,
    paddingBottom: 36,
  },
  brandLogo: {
    width: 150,
    height: 42,
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    marginBottom: 4,
  },
  block: {
    gap: 6,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
  },
  blockTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  blockBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  supportButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  supportButtonText: {
    color: colors.onPill,
    fontSize: 15,
    fontWeight: '900',
  },
}); }
