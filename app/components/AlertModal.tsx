import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { usePro } from '../contexts/ProContext';
import { useWatchlist } from '../contexts/WatchlistContext';
import { useTheme } from '../contexts/ThemeContext';
import { requestNotificationPermission } from '../lib/actions';
import { BRAND } from '../lib/catalog';
import { EmailAlertSyncError, emailAlertCopy } from '../lib/emailAlertSync';
import { modelIdentity, type ModelWatchSource } from '../lib/modelWatch';
import { convertAmount } from '../lib/currency';
import {
  convertAlertPriceReference,
  initialAlertEditorValue,
  roundCurrencyAmount,
  shouldInitializeAlertEditor,
  validAlertTargetCurrency,
  type AlertPriceReference,
} from '../lib/alertPriceReference';
import { radii, typography, type ThemeColors } from '../lib/theme';
import type { AlertDraft } from '../lib/watchlist';
import { watchSnapshot } from '../lib/watchlist';
import { alertSheetCopy } from '../lib/watchI18n';
import { runPriceMonitor } from '../lib/priceMonitorTask';
import type { WatchEntry, WatchProductSnapshot } from '../lib/types';
import { ProGate } from './ProGate';
import { TopoPlaceholder } from './TopoPlaceholder';

type Props = { visible: boolean; source: ModelWatchSource | WatchProductSnapshot; priceReference: AlertPriceReference; entry?: WatchEntry; lockedScope?: 'sku' | 'model'; historicalLow?: number | null; onClose: () => void; onDelete?: (scope: 'sku' | 'model') => Promise<void>; onSubmit: (draft: AlertDraft, scope: 'sku' | 'model') => Promise<boolean> };

export function AlertModal({ visible, source, priceReference, entry, lockedScope, historicalLow, onClose, onDelete, onSubmit }: Props) {
  const preferences = usePreferences();
  const { isPro } = usePro();
  const watchlist = useWatchlist();
  const { colors: palette } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const copy = alertSheetCopy(preferences.language);
  const emailCopy = emailAlertCopy(preferences.language);
  const snapshot = 'price' in source && 'name' in source ? source : watchSnapshot(source);
  const fullSource = 'price' in source && 'name' in source ? null : source;
  const canUseSku = Boolean(fullSource && 'sku_id' in fullSource);
  const initialScope = lockedScope || entry?.scope || (canUseSku ? 'sku' : 'model');
  const [scope, setScope] = useState<'sku' | 'model'>(initialScope);
  const canUseModel = Boolean(entry?.modelKey || (fullSource && modelIdentity(fullSource)));
  const selectedEntry = entry?.scope === scope ? entry : (fullSource ? (scope === 'model' ? watchlist.getModelEntry(fullSource) : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id) : undefined)) : undefined);
  const existingAlert = selectedEntry?.alert;
  const referenceCurrency = priceReference.currency || '';
  const defaultCurrency = referenceCurrency ? preferences.displayedCurrency(referenceCurrency) : existingAlert?.targetCurrency || '';
  const [targetCurrency, setTargetCurrency] = useState(defaultCurrency);
  const comparableReferenceAmount = convertAlertPriceReference(priceReference, targetCurrency, preferences.rateSnapshot);
  const lowConversion = historicalLow && priceReference.kind !== 'unavailable'
    ? convertAmount(historicalLow, priceReference.currency, targetCurrency as never, preferences.rateSnapshot)
    : null;
  const low = comparableReferenceAmount !== null && lowConversion
    && (priceReference.kind !== 'unavailable' && priceReference.currency === targetCurrency || lowConversion.converted)
    && Number.isFinite(lowConversion.value) && lowConversion.value > 0 && lowConversion.value < comparableReferenceAmount
    ? lowConversion.value : null;
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
  const placeholderBrand = BRAND[snapshot.brand]?.label || snapshot.brand;
  const referenceLabel = priceReference.kind === 'live' ? copy.liveReference
    : priceReference.kind === 'catalog' ? copy.catalogReference
      : priceReference.kind === 'saved' ? copy.savedReference : copy.unavailableReference;
  const referenceNote = priceReference.kind === 'catalog' ? copy.catalogNote
    : priceReference.kind === 'saved' ? copy.savedNote
      : priceReference.kind === 'unavailable' ? copy.futureThreshold : null;
  const referenceKey = priceReference.kind === 'unavailable'
    ? `${priceReference.kind}:${priceReference.currency || ''}`
    : `${priceReference.kind}:${priceReference.amount}:${priceReference.currency}:${priceReference.symbol}`;
  const editorSessionKey = `${entry?.id || snapshot.catalogProductId || snapshot.skuId || snapshot.name}:${initialScope}`;
  const initializedEditorSession = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      initializedEditorSession.current = null;
      return;
    }
    if (!shouldInitializeAlertEditor(initializedEditorSession.current, visible, editorSessionKey)) return;
    initializedEditorSession.current = editorSessionKey;
    setScope(initialScope);
    const existing = entry?.scope === initialScope ? entry.alert : (fullSource ? (initialScope === 'model' ? watchlist.getModelEntry(fullSource)?.alert : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id)?.alert : undefined)) : undefined);
    const initial = initialAlertEditorValue(priceReference, defaultCurrency, existing, preferences.rateSnapshot);
    setMode(initial.mode);
    setTarget(String(initial.target));
    setTargetCurrency(initial.currency);
    setLocalEnabled(existing?.localEnabled ?? true);
    setEmail(existing?.email || '');
    setEmailOpen(Boolean(existing?.email));
    setError(null);
  }, [visible, editorSessionKey, referenceKey, defaultCurrency]);

  function chooseScope(nextScope: 'sku' | 'model') {
    setScope(nextScope);
    const existing = entry?.scope === nextScope ? entry.alert : (fullSource ? (nextScope === 'model' ? watchlist.getModelEntry(fullSource)?.alert : (canUseSku && 'sku_id' in fullSource ? watchlist.getEntry(fullSource.sku_id)?.alert : undefined)) : undefined);
    const initial = initialAlertEditorValue(priceReference, defaultCurrency, existing, preferences.rateSnapshot);
    setMode(initial.mode); setTarget(String(initial.target)); setTargetCurrency(initial.currency); setLocalEnabled(existing?.localEnabled ?? true);
    setEmail(existing?.email || ''); setEmailOpen(Boolean(existing?.email));
  }

  function chooseMode(nextMode: AlertDraft['mode']) {
    if (nextMode !== 'custom' && comparableReferenceAmount === null) return;
    setMode(nextMode);
    if (nextMode === 'percent10' && comparableReferenceAmount !== null) setTarget(String(roundCurrencyAmount(comparableReferenceAmount * 0.9, targetCurrency)));
    else if (nextMode === 'historicalLow' && low) setTarget(String(low));
  }

  async function submit() {
    const normalizedEmail = supportsEmail ? email.trim().toLowerCase() : '';
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError(copy.invalidEmail);
    if (!validAlertTargetCurrency(targetCurrency) || !Number.isFinite(amount) || amount <= 0) return setError(copy.invalidTarget);
    if (mode !== 'custom' && comparableReferenceAmount === null) return setError(copy.invalidTarget);
    if (comparableReferenceAmount !== null && amount >= comparableReferenceAmount && priceReference.kind !== 'unavailable') return setError(copy.targetBelow(priceReference.kind));
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
      if (localEnabled) void runPriceMonitor(preferences.language).catch(() => undefined);
      onClose();
    } catch (nextError) {
      if (nextError instanceof EmailAlertSyncError && nextError.localStateSaved && localEnabled) {
        void runPriceMonitor(preferences.language).catch(() => undefined);
      }
      setError(nextError instanceof EmailAlertSyncError
        ? (nextError.localStateSaved ? emailCopy.saved : emailCopy.failed)
        : nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setBusy(false); }
  }

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.handle} /><Text style={styles.title}>{copy.title}</Text><View style={styles.productRow}><View style={styles.thumb}><TopoPlaceholder category={snapshot.category} brand={placeholderBrand} compact showLabel={false} />{snapshot.imageUrl ? <Image source={{ uri: snapshot.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View><Text style={styles.product} numberOfLines={2}>{snapshot.name}</Text></View>
        <Text style={styles.current}>{referenceLabel}{priceReference.kind !== 'unavailable' ? ` ${preferences.formatMoney(priceReference.amount, priceReference.currency, priceReference.symbol)}` : ''}</Text>
        {referenceNote ? <Text style={styles.referenceNote}>{referenceNote}</Text> : null}
        {priceReference.kind !== 'unavailable' && comparableReferenceAmount === null ? <Text style={styles.referenceNote}>{copy.futureThreshold}</Text> : null}
        {lockedScope ? <Text style={styles.lockedScope}>{scope === 'model' ? copy.modelScope : copy.itemScope}</Text> : <View style={styles.presets}>
          {canUseSku ? <Preset label={copy.itemScope} selected={scope === 'sku'} onPress={() => chooseScope('sku')} styles={styles} /> : null}
          {canUseModel ? <Preset label={copy.modelScope} selected={scope === 'model'} onPress={() => chooseScope('model')} styles={styles} /> : null}
        </View>}
        <Text style={styles.label}>{copy.target} · {targetCurrency}</Text>
        <View style={styles.presets}>
          <Preset label={copy.tenPercent} selected={mode === 'percent10'} disabled={comparableReferenceAmount === null} onPress={() => chooseMode('percent10')} styles={styles} />
          <Preset label={copy.historyLow} selected={mode === 'historicalLow'} disabled={comparableReferenceAmount === null || !low} onPress={() => chooseMode('historicalLow')} styles={styles} />
          <Preset label={copy.custom} selected={mode === 'custom'} onPress={() => chooseMode('custom')} styles={styles} />
        </View>
        {mode === 'custom' ? <TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad" style={styles.input} accessibilityLabel={copy.custom} /> : <Text style={styles.targetPreview}>{preferences.formatOriginalMoney(amount, targetCurrency)}</Text>}
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.rowTitle}>{copy.local}</Text><Text style={styles.help}>{copy.background}</Text></View><Switch accessibilityRole="switch" accessibilityLabel={copy.local} value={localEnabled} onValueChange={setLocalEnabled} /></View>
        {supportsEmail ? <Pressable accessibilityRole="button" accessibilityLabel={copy.emailOptional} accessibilityState={{ expanded: emailOpen }} style={styles.emailToggle} onPress={() => setEmailOpen((value) => !value)}><Text style={styles.rowTitle}>{copy.emailOptional}</Text><Text style={styles.chevron}>{emailOpen ? '−' : '+'}</Text></Pressable> : null}
        {supportsEmail && emailOpen ? <><TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} /><Text style={styles.emailHelp}>{emailCopy.independent}</Text></> : null}
        <Text style={styles.quota}>{copy.quota(watchlist.activeAlertCount, watchlist.freeAlertLimit, isPro)}</Text>
        {quotaFull ? <ProGate title={copy.limitReached} subtitle={copy.proUnlimited} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {existingAlert && onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={existingAlert.email ? emailCopy.deleteLocal : copy.deleteAlert} style={[styles.deleteButton, busy && styles.disabled]} disabled={busy} onPress={async () => { setBusy(true); setError(null); try { await onDelete(scope); onClose(); } catch { setError(copy.deleteFailed); } finally { setBusy(false); } }}>{busy ? <ActivityIndicator color={palette.danger} /> : <Text style={styles.deleteText}>{existingAlert.email ? emailCopy.deleteLocal : copy.deleteAlert}</Text>}</Pressable> : null}
        <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} style={[styles.button, styles.secondary]} onPress={onClose} disabled={busy}><Text style={styles.secondaryText}>{copy.cancel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={copy.save} style={[styles.button, styles.primary, (quotaFull || !validAlertTargetCurrency(targetCurrency)) && styles.disabled]} onPress={submit} disabled={busy || quotaFull || !validAlertTargetCurrency(targetCurrency)}>{busy ? <ActivityIndicator color={palette.onPill} /> : <Text style={styles.primaryText}>{copy.save}</Text>}</Pressable></View>
      </ScrollView></View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Preset({ label, selected, disabled, onPress, styles }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: Boolean(disabled) }} style={[styles.preset, selected && styles.presetSelected, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={[styles.presetText, selected && styles.presetTextSelected]}>{label}</Text></Pressable>;
}

function createStyles(c: ThemeColors) { return StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.38)' }, sheet: { maxHeight: '90%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: c.card }, content: { gap: 12, padding: 20, paddingBottom: 34 }, handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: c.hair2 },
  title: { color: c.ink, fontSize: 22, fontWeight: '900' }, product: { flex: 1, color: c.ink, fontSize: 15, fontWeight: '800' }, current: { color: c.muted, fontSize: 13, fontWeight: '700' }, referenceNote: { color: c.muted, fontSize: 11.5, lineHeight: 17 }, lockedScope: { color: c.ink2, fontSize: 12, fontWeight: '900' }, label: { color: c.ink2, fontSize: 12, fontWeight: '800' }, presets: { flexDirection: 'row', gap: 8 },
  productRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 }, thumb: { width: 52, height: 64, overflow: 'hidden', borderRadius: 9, backgroundColor: c.photo },
  preset: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, paddingHorizontal: 6 }, presetSelected: { backgroundColor: c.pill, borderColor: c.pill }, presetText: { color: c.ink2, fontSize: 12, fontWeight: '800', textAlign: 'center' }, presetTextSelected: { color: c.onPill },
  input: { minHeight: 48, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair2, color: c.ink, backgroundColor: c.screen, paddingHorizontal: 12, fontSize: 16 }, targetPreview: { color: c.disc, fontFamily: typography.mono, fontSize: 24, fontWeight: '900' },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair }, flex: { flex: 1 }, rowTitle: { color: c.ink, fontSize: 14, fontWeight: '800' }, help: { color: c.muted, marginTop: 3, fontSize: 12, lineHeight: 17 }, emailToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, emailHelp: { color: c.muted, fontSize: 11.5, lineHeight: 17 }, chevron: { color: c.ink, fontSize: 20 },
  quota: { color: c.muted, fontSize: 12, fontWeight: '700' }, error: { color: c.disc, fontSize: 13, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 10 }, button: { minHeight: 52, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, secondary: { backgroundColor: c.screen }, primary: { backgroundColor: c.pill }, disabled: { opacity: 0.42 }, secondaryText: { color: c.ink, fontWeight: '800' }, primaryText: { color: c.onPill, fontWeight: '900' },
  deleteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, deleteText: { color: c.danger, fontWeight: '800' },
}); }
