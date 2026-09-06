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
