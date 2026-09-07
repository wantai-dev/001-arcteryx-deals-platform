import { convertAmount, type RateSnapshot } from './currency';
import type { AppLanguage } from './i18n';
import type { PriceAlertRequest } from './types';
import type { AlertDraft } from './watchlist';

export class EmailAlertSyncError extends Error {
  constructor(readonly localStateSaved: boolean, options?: ErrorOptions) {
    super('email_alert_sync_failed', options);
    this.name = 'EmailAlertSyncError';
  }
}

type Dependencies = {
  skuId?: string;
  sourceCurrency: string;
  rates: RateSnapshot | null;
  saveLocal: (draft: AlertDraft) => Promise<boolean>;
  registerEmail: (request: PriceAlertRequest) => Promise<unknown>;
  /** Remove only this draft's unconfirmed email, preserving concurrent edits. */
  clearUnconfirmedEmail: (draft: AlertDraft) => Promise<void>;
};

/** Both SKU entry points use the same real email upsert after local quota checks. */
export async function saveAlertAndSyncEmail(draft: AlertDraft, deps: Dependencies): Promise<boolean> {
  const accepted = await deps.saveLocal(draft);
  if (!accepted || !draft.email?.trim()) return accepted;
  try {
    if (!deps.skuId) throw new Error('Email alerts require an item identifier.');
    const converted = convertAmount(draft.targetAmount, draft.targetCurrency, deps.sourceCurrency as never, deps.rates);
    if (converted.currency !== deps.sourceCurrency || !Number.isFinite(converted.value) || converted.value <= 0) {
      throw new Error('Email alert target cannot be converted to the source currency.');
    }
    await deps.registerEmail({
      sku_id: deps.skuId,
      email: draft.email.trim().toLowerCase(),
      target_price: converted.value,
    });
    return true;
  } catch (cause) {
    try {
      await deps.clearUnconfirmedEmail(draft);
    } catch (cleanupCause) {
      throw new EmailAlertSyncError(false, { cause: new AggregateError([cause, cleanupCause]) });
    }
    throw new EmailAlertSyncError(true, { cause });
  }
}

const COPY = {
  en: {
    independent: 'Email is a separate subscription. Editing or deleting a device alert does not unsubscribe email; use the unsubscribe link in an alert email.',
    saved: 'Device settings were saved, but email was not updated. Any existing email subscription remains managed through its unsubscribe link.',
    failed: 'Email and device settings could not be synchronized. Reopen this alert and retry.',
    deleteLocal: 'Delete device alert',
  },
  'zh-Hans': {
    independent: '邮箱为独立订阅。编辑或删除本机提醒不会退订邮件；请使用提醒邮件中的退订链接。',
    saved: '本机设置已保存，但邮箱订阅未更新。已有邮箱订阅请通过邮件中的退订链接管理。',
    failed: '邮箱与本机设置未能同步，请重新打开这条提醒后重试。',
    deleteLocal: '删除本机提醒',
  },
  de: {
    independent: 'E-Mail ist ein separates Abonnement. Änderungen oder das Löschen eines Gerätealarms melden E-Mails nicht ab. Nutze dafür den Abmeldelink in einer Alarm-E-Mail.',
    saved: 'Geräteeinstellungen gespeichert, E-Mail nicht aktualisiert. Bestehende E-Mail-Abos lassen sich über den Abmeldelink verwalten.',
    failed: 'E-Mail und Geräteeinstellungen konnten nicht synchronisiert werden. Öffne den Alarm erneut und versuche es noch einmal.',
    deleteLocal: 'Gerätealarm löschen',
  },
  fr: {
    independent: 'L’e-mail est un abonnement distinct. Modifier ou supprimer une alerte sur l’appareil ne désabonne pas les e-mails. Utilisez le lien de désabonnement dans un e-mail d’alerte.',
    saved: 'Réglages de l’appareil enregistrés, mais e-mail non mis à jour. Gérez tout abonnement existant avec son lien de désabonnement.',
    failed: 'Impossible de synchroniser l’e-mail et les réglages. Rouvrez cette alerte et réessayez.',
    deleteLocal: 'Supprimer l’alerte de l’appareil',
  },
  ja: {
    independent: 'メールは別の購読です。端末の通知を編集・削除しても配信は解除されません。通知メール内の配信解除リンクをご利用ください。',
    saved: '端末の設定は保存されましたが、メール購読は更新されませんでした。既存の購読はメール内の配信解除リンクから管理してください。',
    failed: 'メールと端末の設定を同期できませんでした。この通知を開き直して再試行してください。',
    deleteLocal: '端末の通知を削除',
  },
} satisfies Record<AppLanguage, Record<string, string>>;

export const emailAlertCopy = (language: AppLanguage) => COPY[language];
