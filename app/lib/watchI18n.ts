import type { AppLanguage } from './i18n';

type WatchCopy = {
  alertTitle: string;
  alertBody: (name: string, price: string) => string;
  backgroundTiming: string;
  killedWarning: string;
};

const COPY: Record<AppLanguage, WatchCopy> = {
  en: {
    alertTitle: 'Target price reached',
    alertBody: (name, price) => `${name} is now ${price}.`,
    backgroundTiming: 'Your device chooses when background checks run.',
    killedWarning: 'Checks pause after you force-quit the app and resume when you reopen it.',
  },
  'zh-Hans': {
    alertTitle: '已到目标价',
    alertBody: (name, price) => `${name} 当前价格 ${price}。`,
    backgroundTiming: '后台检查时间由系统择时决定。',
    killedWarning: '强制退出 App 后检查会暂停，重新打开后恢复。',
  },
  de: {
    alertTitle: 'Zielpreis erreicht',
    alertBody: (name, price) => `${name} kostet jetzt ${price}.`,
    backgroundTiming: 'Das Gerät bestimmt den Zeitpunkt der Hintergrundprüfung.',
    killedWarning: 'Nach dem Beenden der App pausieren Prüfungen bis zum nächsten Öffnen.',
  },
  fr: {
    alertTitle: 'Prix cible atteint',
    alertBody: (name, price) => `${name} coûte maintenant ${price}.`,
    backgroundTiming: 'Votre appareil choisit quand effectuer les vérifications en arrière-plan.',
    killedWarning: 'Les vérifications sont suspendues après avoir forcé la fermeture, puis reprennent à la réouverture.',
  },
  ja: {
    alertTitle: '目標価格になりました',
    alertBody: (name, price) => `${name}が${price}になりました。`,
    backgroundTiming: 'バックグラウンド確認の時刻は端末が決定します。',
    killedWarning: 'アプリを強制終了すると確認が停止し、再起動後に再開します。',
  },
};

export function watchCopy(language: AppLanguage): WatchCopy {
  return COPY[language] || COPY.en;
}

type AlertSheetCopy = {
  title: string; current: string; target: string; tenPercent: string; historyLow: string;
  custom: string; local: string; background: string; emailOptional: string;
  invalidEmail: string; targetBelow: string; chooseChannel: string; permissionDenied: string;
  limitReached: string; proUnlimited: string; cancel: string; save: string;
  quota: (used: number, limit: number, isPro: boolean) => string;
};

const ALERT_COPY: Record<AppLanguage, AlertSheetCopy> = {
  en: { title: 'Price alert', current: 'Current', target: 'Target currency', tenPercent: '10% lower', historyLow: 'Historical low', custom: 'Custom', local: 'Local notification', background: COPY.en.backgroundTiming, emailOptional: 'Email too (optional)', invalidEmail: 'Enter a valid email address.', targetBelow: 'Target must be below the current price.', chooseChannel: 'Choose at least one notification method.', permissionDenied: 'Allow notifications in system settings to use local alerts.', limitReached: 'Free alert limit reached', proUnlimited: 'Pro includes unlimited alerts.', cancel: 'Cancel', save: 'Save alert', quota: (used, limit, pro) => pro ? `${used} active · Pro unlimited` : `${used} of ${limit} free alert used` },
  'zh-Hans': { title: '到价提醒', current: '当前', target: '目标币种', tenPercent: '降 10%', historyLow: '历史低点', custom: '自定义', local: '本机通知', background: COPY['zh-Hans'].backgroundTiming, emailOptional: '同时发邮件（可选）', invalidEmail: '请输入有效邮箱。', targetBelow: '目标价必须低于当前价。', chooseChannel: '请至少选择一种提醒方式。', permissionDenied: '请在系统设置中允许通知。', limitReached: '免费提醒额度已用完', proUnlimited: 'Pro 可设置不限数量的提醒。', cancel: '取消', save: '保存提醒', quota: (used, limit, pro) => pro ? `${used} 个生效 · Pro 不限` : `免费额度 ${used}/${limit}` },
  de: { title: 'Preisalarm', current: 'Aktuell', target: 'Zielwährung', tenPercent: '10 % günstiger', historyLow: 'Tiefstpreis', custom: 'Eigener Preis', local: 'Lokale Mitteilung', background: COPY.de.backgroundTiming, emailOptional: 'Zusätzlich per E-Mail (optional)', invalidEmail: 'Gültige E-Mail-Adresse eingeben.', targetBelow: 'Der Zielpreis muss unter dem aktuellen Preis liegen.', chooseChannel: 'Mindestens eine Benachrichtigung wählen.', permissionDenied: 'Mitteilungen in den Systemeinstellungen erlauben.', limitReached: 'Gratislimit erreicht', proUnlimited: 'Pro bietet unbegrenzte Alarme.', cancel: 'Abbrechen', save: 'Alarm speichern', quota: (used, limit, pro) => pro ? `${used} aktiv · Pro unbegrenzt` : `${used} von ${limit} Gratisalarm genutzt` },
  fr: { title: 'Alerte de prix', current: 'Actuel', target: 'Devise cible', tenPercent: '−10 %', historyLow: 'Plus bas historique', custom: 'Personnalisé', local: 'Notification locale', background: COPY.fr.backgroundTiming, emailOptional: 'E-mail aussi (facultatif)', invalidEmail: 'Saisissez une adresse e-mail valide.', targetBelow: 'Le prix cible doit être inférieur au prix actuel.', chooseChannel: 'Choisissez au moins un mode de notification.', permissionDenied: 'Autorisez les notifications dans les réglages système.', limitReached: 'Limite gratuite atteinte', proUnlimited: 'Pro inclut des alertes illimitées.', cancel: 'Annuler', save: 'Enregistrer', quota: (used, limit, pro) => pro ? `${used} actives · Pro illimité` : `${used} alerte gratuite sur ${limit}` },
  ja: { title: '価格通知', current: '現在', target: '目標通貨', tenPercent: '10%値下げ', historyLow: '過去最安値', custom: 'カスタム', local: '端末通知', background: COPY.ja.backgroundTiming, emailOptional: 'メールも送信（任意）', invalidEmail: '有効なメールアドレスを入力してください。', targetBelow: '目標価格は現在価格より低くしてください。', chooseChannel: '通知方法を1つ以上選択してください。', permissionDenied: 'システム設定で通知を許可してください。', limitReached: '無料通知の上限です', proUnlimited: 'Pro は通知数が無制限です。', cancel: 'キャンセル', save: '保存', quota: (used, limit, pro) => pro ? `${used}件有効・Pro無制限` : `無料枠 ${used}/${limit}` },
};

export function alertSheetCopy(language: AppLanguage) { return ALERT_COPY[language] || ALERT_COPY.en; }

const WATCHLIST_COPY = {
  en: { title: 'Watchlist', models: 'Watched models', items: 'Watched items', model: 'Model', item: 'Item', gear: 'Gear', remove: 'Remove from watchlist', noChange: 'No price change since saved', alertAt: 'Alert at', legacyAlert: 'Confirm this legacy alert to enable local checks.', now: 'now', emptyTitle: 'Nothing saved yet', emptyBody: 'Save items from Deals or models from Yearbook.', proUnlimited: 'Pro includes unlimited active alerts.', summary: (saved: number, alerts: number) => `${saved} saved · ${alerts} active alerts`, changed: (direction: string, amount: string) => `${direction} ${amount} since saved`, freeLimit: (limit: number) => `Free plan: ${limit} alert` },
  'zh-Hans': { title: '关注', models: '关注的型号', items: '关注的单品', model: '型号', item: '单品', gear: '装备', remove: '取消关注', noChange: '收藏后价格平稳', alertAt: '提醒价', legacyAlert: '请确认旧提醒后启用本机检查。', now: '当前', emptyTitle: '还没有关注', emptyBody: '可从折扣收藏单品，或从图鉴关注型号。', proUnlimited: 'Pro 可设置不限数量的提醒。', summary: (saved: number, alerts: number) => `${saved} 个关注 · ${alerts} 个提醒`, changed: (direction: string, amount: string) => `收藏后 ${direction} ${amount}`, freeLimit: (limit: number) => `免费可设 ${limit} 个提醒` },
  de: { title: 'Merkliste', models: 'Beobachtete Modelle', items: 'Beobachtete Artikel', model: 'Modell', item: 'Artikel', gear: 'Ausrüstung', remove: 'Entfernen', noChange: 'Preis seit dem Speichern stabil', alertAt: 'Alarm bei', legacyAlert: 'Alten Alarm bestätigen, um lokale Prüfungen zu aktivieren.', now: 'jetzt', emptyTitle: 'Noch nichts gespeichert', emptyBody: 'Artikel in Deals oder Modelle im Yearbook speichern.', proUnlimited: 'Pro bietet unbegrenzte aktive Alarme.', summary: (saved: number, alerts: number) => `${saved} gespeichert · ${alerts} Alarme`, changed: (direction: string, amount: string) => `${direction} ${amount} seit dem Speichern`, freeLimit: (limit: number) => `Gratis: ${limit} Alarm` },
  fr: { title: 'Suivis', models: 'Modèles suivis', items: 'Articles suivis', model: 'Modèle', item: 'Article', gear: 'Équipement', remove: 'Retirer', noChange: 'Prix stable depuis l’ajout', alertAt: 'Alerte à', legacyAlert: 'Confirmez cette ancienne alerte pour activer les vérifications locales.', now: 'actuel', emptyTitle: 'Aucun suivi', emptyBody: 'Ajoutez un article des offres ou un modèle du Yearbook.', proUnlimited: 'Pro inclut des alertes actives illimitées.', summary: (saved: number, alerts: number) => `${saved} suivis · ${alerts} alertes`, changed: (direction: string, amount: string) => `${direction} ${amount} depuis l’ajout`, freeLimit: (limit: number) => `Gratuit : ${limit} alerte` },
  ja: { title: 'ウォッチリスト', models: 'モデル', items: '商品', model: 'モデル', item: '商品', gear: 'ギア', remove: '削除', noChange: '保存後の価格は横ばい', alertAt: '通知価格', legacyAlert: '以前の通知を確認して端末チェックを有効にしてください。', now: '現在', emptyTitle: 'まだ登録がありません', emptyBody: 'Dealsの商品またはYearbookのモデルを登録できます。', proUnlimited: 'Pro は有効な通知数が無制限です。', summary: (saved: number, alerts: number) => `${saved}件登録・通知${alerts}件`, changed: (direction: string, amount: string) => `保存後 ${direction}${amount}`, freeLimit: (limit: number) => `無料：通知${limit}件` },
};

export function watchListCopy(language: AppLanguage) { return WATCHLIST_COPY[language] || WATCHLIST_COPY.en; }
