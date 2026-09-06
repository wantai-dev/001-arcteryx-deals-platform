import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useColorScheme, View } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { usePro } from '../contexts/ProContext';
import { useWatchlist } from '../contexts/WatchlistContext';
import { requestNotificationPermission } from '../lib/actions';
import type { ModelWatchSource } from '../lib/modelWatch';
import { darkTokens, lightTokens, radii, typography } from '../lib/theme';
import type { AlertDraft } from '../lib/watchlist';
import { watchSnapshot } from '../lib/watchlist';
import { alertSheetCopy } from '../lib/watchI18n';
import type { WatchEntry } from '../lib/types';
import { ProGate } from './ProGate';

type Props = { visible: boolean; source: ModelWatchSource; entry?: WatchEntry; historicalLow?: number | null; onClose: () => void; onSubmit: (draft: AlertDraft) => Promise<boolean> };

export function AlertModal({ visible, source, entry, historicalLow, onClose, onSubmit }: Props) {
  const preferences = usePreferences();
  const { isPro } = usePro();
  const watchlist = useWatchlist();
  const palette = useColorScheme() === 'dark' ? darkTokens : lightTokens;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const copy = alertSheetCopy(preferences.language);
  const snapshot = watchSnapshot(source);
  const current = preferences.convertValue(snapshot.price, snapshot.currency);
  const currency = preferences.displayedCurrency(snapshot.currency);
  const low = historicalLow ? preferences.convertValue(historicalLow, snapshot.currency) : null;
  const [mode, setMode] = useState<AlertDraft['mode']>('percent10');
  const [target, setTarget] = useState('');
  const [localEnabled, setLocalEnabled] = useState(true);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existingActive = Boolean(entry?.alert?.localEnabled || entry?.alert?.email);
  const supportsEmail = 'sku_id' in source;
  const quotaFull = !isPro && !existingActive && watchlist.activeAlertCount >= watchlist.freeAlertLimit;
  const amount = mode === 'percent10' ? current * 0.9 : mode === 'historicalLow' && low ? low : Number(target);

  useEffect(() => {
    if (!visible) return;
    const existing = entry?.alert;
    setMode(existing?.mode || 'percent10');
    setTarget(existing ? String(existing.targetAmount) : String(Math.floor(current * 0.9)));
    setLocalEnabled(existing?.localEnabled ?? true);
    setEmail(existing?.email || '');
    setEmailOpen(Boolean(existing?.email));
    setError(null);
  }, [current, entry?.alert, visible]);

  async function submit() {
    const normalizedEmail = supportsEmail ? email.trim().toLowerCase() : '';
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError(copy.invalidEmail);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= current) return setError(copy.targetBelow);
    if (!localEnabled && !normalizedEmail) return setError(copy.chooseChannel);
    if (quotaFull) return;
    setBusy(true); setError(null);
    try {
      if (localEnabled && !(await requestNotificationPermission())) return setError(copy.permissionDenied);
      const accepted = await onSubmit({ mode, targetAmount: amount, targetCurrency: currency, localEnabled, ...(normalizedEmail ? { email: normalizedEmail } : {}) });
      if (!accepted) return setError(copy.limitReached);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setBusy(false); }
  }

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.handle} /><Text style={styles.title}>{copy.title}</Text><Text style={styles.product} numberOfLines={2}>{snapshot.name}</Text>
        <Text style={styles.current}>{copy.current} {preferences.formatMoney(snapshot.price, snapshot.currency, snapshot.symbol)}</Text>
        <Text style={styles.label}>{copy.target} · {currency}</Text>
        <View style={styles.presets}>
          <Preset label={copy.tenPercent} selected={mode === 'percent10'} onPress={() => setMode('percent10')} styles={styles} />
          <Preset label={copy.historyLow} selected={mode === 'historicalLow'} disabled={!low} onPress={() => setMode('historicalLow')} styles={styles} />
          <Preset label={copy.custom} selected={mode === 'custom'} onPress={() => setMode('custom')} styles={styles} />
        </View>
        {mode === 'custom' ? <TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" style={styles.input} accessibilityLabel={copy.custom} /> : <Text style={styles.targetPreview}>{preferences.formatOriginalMoney(amount, currency)}</Text>}
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.rowTitle}>{copy.local}</Text><Text style={styles.help}>{copy.background}</Text></View><Switch value={localEnabled} onValueChange={setLocalEnabled} /></View>
        {supportsEmail ? <Pressable style={styles.emailToggle} onPress={() => setEmailOpen((value) => !value)}><Text style={styles.rowTitle}>{copy.emailOptional}</Text><Text style={styles.chevron}>{emailOpen ? '−' : '+'}</Text></Pressable> : null}
        {supportsEmail && emailOpen ? <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} /> : null}
        <Text style={styles.quota}>{copy.quota(watchlist.activeAlertCount, watchlist.freeAlertLimit, isPro)}</Text>
        {quotaFull ? <ProGate title={copy.limitReached} subtitle={copy.proUnlimited} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}><Pressable style={[styles.button, styles.secondary]} onPress={onClose} disabled={busy}><Text style={styles.secondaryText}>{copy.cancel}</Text></Pressable><Pressable style={[styles.button, styles.primary, quotaFull && styles.disabled]} onPress={submit} disabled={busy || quotaFull}>{busy ? <ActivityIndicator color={palette.onPill} /> : <Text style={styles.primaryText}>{copy.save}</Text>}</Pressable></View>
      </ScrollView></View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Preset({ label, selected, disabled, onPress, styles }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable style={[styles.preset, selected && styles.presetSelected, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={[styles.presetText, selected && styles.presetTextSelected]}>{label}</Text></Pressable>;
}

function createStyles(c: typeof lightTokens) { return StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.38)' }, sheet: { maxHeight: '90%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: c.card }, content: { gap: 12, padding: 20, paddingBottom: 34 }, handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: c.hair2 },
  title: { color: c.ink, fontSize: 22, fontWeight: '900' }, product: { color: c.ink, fontSize: 15, fontWeight: '800' }, current: { color: c.muted, fontSize: 13, fontWeight: '700' }, label: { color: c.ink2, fontSize: 12, fontWeight: '800' }, presets: { flexDirection: 'row', gap: 8 },
  preset: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, paddingHorizontal: 6 }, presetSelected: { backgroundColor: c.pill, borderColor: c.pill }, presetText: { color: c.ink2, fontSize: 12, fontWeight: '800', textAlign: 'center' }, presetTextSelected: { color: c.onPill },
  input: { minHeight: 48, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, color: c.ink, backgroundColor: c.screen, paddingHorizontal: 12, fontSize: 16 }, targetPreview: { color: c.disc, fontFamily: typography.mono, fontSize: 24, fontWeight: '900' },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair }, flex: { flex: 1 }, rowTitle: { color: c.ink, fontSize: 14, fontWeight: '800' }, help: { color: c.muted, marginTop: 3, fontSize: 12, lineHeight: 17 }, emailToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chevron: { color: c.ink, fontSize: 20 },
  quota: { color: c.muted, fontSize: 12, fontWeight: '700' }, error: { color: c.disc, fontSize: 13, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 10 }, button: { minHeight: 52, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, secondary: { backgroundColor: c.screen }, primary: { backgroundColor: c.pill }, disabled: { opacity: 0.42 }, secondaryText: { color: c.ink, fontWeight: '800' }, primaryText: { color: c.onPill, fontWeight: '900' },
}); }
