import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { usePro } from '../contexts/ProContext';
import { useWatchlist } from '../contexts/WatchlistContext';
import { useTheme } from '../contexts/ThemeContext';
import { requestNotificationPermission } from '../lib/actions';
import { modelIdentity, type ModelWatchSource } from '../lib/modelWatch';
import { convertAmount } from '../lib/currency';
import { initialAlertEditorValue } from '../lib/alertEditor';
import { radii, typography, type ThemeColors } from '../lib/theme';
import type { AlertDraft } from '../lib/watchlist';
import { watchSnapshot } from '../lib/watchlist';
import { alertSheetCopy } from '../lib/watchI18n';
import type { WatchEntry, WatchProductSnapshot } from '../lib/types';
import { ProGate } from './ProGate';
import { TopoPlaceholder } from './TopoPlaceholder';

type Props = { visible: boolean; source: ModelWatchSource | WatchProductSnapshot; entry?: WatchEntry; lockedScope?: 'sku' | 'model'; historicalLow?: number | null; onClose: () => void; onDelete?: (scope: 'sku' | 'model') => Promise<void>; onSubmit: (draft: AlertDraft, scope: 'sku' | 'model') => Promise<boolean> };

export function AlertModal({ visible, source, entry, lockedScope, historicalLow, onClose, onDelete, onSubmit }: Props) {
  const preferences = usePreferences();
  const { isPro } = usePro();
  const watchlist = useWatchlist();
  const { colors: palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const copy = alertSheetCopy(preferences.language);
  const snapshot = 'price' in source && 'name' in source ? source : watchSnapshot(source);
  const [scope, setScope] = useState<'sku' | 'model'>('sku');
  const fullSource = 'price' in source && 'name' in source ? null : source;
  const canUseSku = Boolean(fullSource && 'sku_id' in fullSource);
  const canUseModel = Boolean(entry?.modelKey || (fullSource && modelIdentity(fullSource)));
  const selectedEntry = entry?.scope === scope ? entry : (fullSource ? (scope === 'model' ? watchlist.getModelEntry(fullSource) : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id) : undefined)) : undefined);
  const existingAlert = selectedEntry?.alert;
  const defaultCurrency = preferences.displayedCurrency(snapshot.currency);
  const [targetCurrency, setTargetCurrency] = useState(defaultCurrency);
  const currentConversion = convertAmount(snapshot.price, snapshot.currency, targetCurrency as never, preferences.rateSnapshot);
  const current = snapshot.currency === targetCurrency || currentConversion.converted ? currentConversion.value : Number.NaN;
  const lowConversion = historicalLow ? convertAmount(historicalLow, snapshot.currency, targetCurrency as never, preferences.rateSnapshot) : null;
  const low = lowConversion && (snapshot.currency === targetCurrency || lowConversion.converted) ? lowConversion.value : null;
  const [mode, setMode] = useState<AlertDraft['mode']>('percent10');
  const [target, setTarget] = useState('');
  const [localEnabled, setLocalEnabled] = useState(true);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existingActive = Boolean(existingAlert?.localEnabled || existingAlert?.email);
  const supportsEmail = canUseSku && scope === 'sku';
  const quotaFull = !isPro && !existingActive && watchlist.activeAlertCount >= watchlist.freeAlertLimit;
  const amount = Number(target);

  useEffect(() => {
    if (!visible) return;
    const initialScope = lockedScope || entry?.scope || (canUseSku ? 'sku' : 'model');
    setScope(initialScope);
    const existing = entry?.scope === initialScope ? entry.alert : (fullSource ? (initialScope === 'model' ? watchlist.getModelEntry(fullSource)?.alert : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id)?.alert : undefined)) : undefined);
    const initial = initialAlertEditorValue(snapshot.price, snapshot.currency, defaultCurrency, existing, preferences.rateSnapshot);
    setMode(initial.mode);
    setTarget(String(initial.target));
    setTargetCurrency(initial.currency);
    setLocalEnabled(existing?.localEnabled ?? true);
    setEmail(existing?.email || '');
    setEmailOpen(Boolean(existing?.email));
    setError(null);
  }, [visible, entry?.id, snapshot.price, snapshot.currency, defaultCurrency]);

  function chooseScope(nextScope: 'sku' | 'model') {
    setScope(nextScope);
    const existing = entry?.scope === nextScope ? entry.alert : (fullSource ? (nextScope === 'model' ? watchlist.getModelEntry(fullSource)?.alert : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id)?.alert : undefined)) : undefined);
    const initial = initialAlertEditorValue(snapshot.price, snapshot.currency, defaultCurrency, existing, preferences.rateSnapshot);
    setMode(initial.mode); setTarget(String(initial.target)); setTargetCurrency(initial.currency); setLocalEnabled(existing?.localEnabled ?? true);
    setEmail(existing?.email || ''); setEmailOpen(Boolean(existing?.email));
  }

  function chooseMode(nextMode: AlertDraft['mode']) {
    setMode(nextMode);
    if (nextMode === 'percent10') setTarget(String(Math.floor(current * 0.9)));
    else if (nextMode === 'historicalLow' && low) setTarget(String(low));
  }

  async function submit() {
    const normalizedEmail = supportsEmail ? email.trim().toLowerCase() : '';
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError(copy.invalidEmail);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= current) return setError(copy.targetBelow);
    if (!localEnabled && !normalizedEmail) return setError(copy.chooseChannel);
    if (quotaFull) return;
    setBusy(true); setError(null);
    try {
      if (localEnabled) {
        if (!(await requestNotificationPermission())) return setError(copy.permissionDenied);
        await preferences.setNotificationsEnabled(true);
      }
      const accepted = await onSubmit({ mode, targetAmount: amount, targetCurrency, localEnabled, ...(normalizedEmail ? { email: normalizedEmail } : {}) }, scope);
      if (!accepted) return setError(copy.limitReached);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setBusy(false); }
  }

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.handle} /><Text style={styles.title}>{copy.title}</Text><View style={styles.productRow}><View style={styles.thumb}><TopoPlaceholder label={snapshot.category} showLabel={false} />{snapshot.imageUrl ? <Image source={{ uri: snapshot.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View><Text style={styles.product} numberOfLines={2}>{snapshot.name}</Text></View>
        <Text style={styles.current}>{copy.current} {preferences.formatMoney(snapshot.price, snapshot.currency, snapshot.symbol)}</Text>
        {!lockedScope ? <View style={styles.presets}>
          {canUseSku ? <Preset label={copy.itemScope} selected={scope === 'sku'} onPress={() => chooseScope('sku')} styles={styles} /> : null}
          {canUseModel ? <Preset label={copy.modelScope} selected={scope === 'model'} onPress={() => chooseScope('model')} styles={styles} /> : null}
        </View> : null}
        <Text style={styles.label}>{copy.target} · {targetCurrency}</Text>
        <View style={styles.presets}>
          <Preset label={copy.tenPercent} selected={mode === 'percent10'} onPress={() => chooseMode('percent10')} styles={styles} />
          <Preset label={copy.historyLow} selected={mode === 'historicalLow'} disabled={!low} onPress={() => chooseMode('historicalLow')} styles={styles} />
          <Preset label={copy.custom} selected={mode === 'custom'} onPress={() => chooseMode('custom')} styles={styles} />
        </View>
        {mode === 'custom' ? <TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" style={styles.input} accessibilityLabel={copy.custom} /> : <Text style={styles.targetPreview}>{preferences.formatOriginalMoney(amount, targetCurrency)}</Text>}
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.rowTitle}>{copy.local}</Text><Text style={styles.help}>{copy.background}</Text></View><Switch value={localEnabled} onValueChange={setLocalEnabled} /></View>
        {supportsEmail ? <Pressable style={styles.emailToggle} onPress={() => setEmailOpen((value) => !value)}><Text style={styles.rowTitle}>{copy.emailOptional}</Text><Text style={styles.chevron}>{emailOpen ? '−' : '+'}</Text></Pressable> : null}
        {supportsEmail && emailOpen ? <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} /> : null}
        <Text style={styles.quota}>{copy.quota(watchlist.activeAlertCount, watchlist.freeAlertLimit, isPro)}</Text>
        {quotaFull ? <ProGate title={copy.limitReached} subtitle={copy.proUnlimited} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {existingAlert && onDelete ? <Pressable style={styles.deleteButton} onPress={async () => { setBusy(true); try { await onDelete(scope); onClose(); } finally { setBusy(false); } }}><Text style={styles.deleteText}>{copy.deleteAlert || 'Delete alert'}</Text></Pressable> : null}
        <View style={styles.actions}><Pressable style={[styles.button, styles.secondary]} onPress={onClose} disabled={busy}><Text style={styles.secondaryText}>{copy.cancel}</Text></Pressable><Pressable style={[styles.button, styles.primary, quotaFull && styles.disabled]} onPress={submit} disabled={busy || quotaFull}>{busy ? <ActivityIndicator color={palette.onPill} /> : <Text style={styles.primaryText}>{copy.save}</Text>}</Pressable></View>
      </ScrollView></View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Preset({ label, selected, disabled, onPress, styles }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable style={[styles.preset, selected && styles.presetSelected, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={[styles.presetText, selected && styles.presetTextSelected]}>{label}</Text></Pressable>;
}

function createStyles(c: ThemeColors) { return StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.38)' }, sheet: { maxHeight: '90%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: c.card }, content: { gap: 12, padding: 20, paddingBottom: 34 }, handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: c.hair2 },
  title: { color: c.ink, fontSize: 22, fontWeight: '900' }, product: { color: c.ink, fontSize: 15, fontWeight: '800' }, current: { color: c.muted, fontSize: 13, fontWeight: '700' }, label: { color: c.ink2, fontSize: 12, fontWeight: '800' }, presets: { flexDirection: 'row', gap: 8 },
  productRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 }, thumb: { width: 52, height: 64, overflow: 'hidden', borderRadius: 9, backgroundColor: c.photo },
  preset: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, paddingHorizontal: 6 }, presetSelected: { backgroundColor: c.pill, borderColor: c.pill }, presetText: { color: c.ink2, fontSize: 12, fontWeight: '800', textAlign: 'center' }, presetTextSelected: { color: c.onPill },
  input: { minHeight: 48, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, color: c.ink, backgroundColor: c.screen, paddingHorizontal: 12, fontSize: 16 }, targetPreview: { color: c.disc, fontFamily: typography.mono, fontSize: 24, fontWeight: '900' },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair }, flex: { flex: 1 }, rowTitle: { color: c.ink, fontSize: 14, fontWeight: '800' }, help: { color: c.muted, marginTop: 3, fontSize: 12, lineHeight: 17 }, emailToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chevron: { color: c.ink, fontSize: 20 },
  quota: { color: c.muted, fontSize: 12, fontWeight: '700' }, error: { color: c.disc, fontSize: 13, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 10 }, button: { minHeight: 52, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, secondary: { backgroundColor: c.screen }, primary: { backgroundColor: c.pill }, disabled: { opacity: 0.42 }, secondaryText: { color: c.ink, fontWeight: '800' }, primaryText: { color: c.onPill, fontWeight: '900' },
  deleteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, deleteText: { color: c.danger, fontWeight: '800' },
}); }
