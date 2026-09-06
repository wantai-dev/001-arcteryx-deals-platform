import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const SUPPORT_URL = 'https://geardrop.100app.dev/support.html';

export function hasNotificationPermission(permissions: Notifications.NotificationPermissionsStatus) {
  if (Platform.OS === 'ios') {
    const status = permissions.ios?.status;
    return (
      status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
      status === Notifications.IosAuthorizationStatus.EPHEMERAL
    );
  }
  return permissions.status === 'granted';
}

export async function softImpact() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Haptics can be unavailable in simulators or web previews.
  }
}

export async function openBuyUrl(url?: string | null) {
  if (!url) return;
  await WebBrowser.openBrowserAsync(url);
}

export async function openSupportUrl() {
  await WebBrowser.openBrowserAsync(SUPPORT_URL);
}

export async function requestNotificationPermission() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('price-alerts', {
        name: 'Price alerts',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    if (hasNotificationPermission(existing)) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return hasNotificationPermission(requested);
  } catch {
    return false;
  }
}

export async function scheduleTestPriceNotification(productName: string) {
  const granted = await requestNotificationPermission();
  if (!granted) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'GearDrop alert armed',
        body: `${productName} is now on your watchlist.`,
        data: { url: '/watchlist' },
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
