import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProductsProvider } from '../contexts/ProductsContext';
import { PreferencesProvider } from '../contexts/PreferencesContext';
import { ProProvider } from '../contexts/ProContext';
import { RegionProvider } from '../contexts/RegionContext';
import { WatchlistProvider } from '../contexts/WatchlistContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { PriceMonitorRegistration } from '../lib/priceMonitorTask';
import { notificationRoute } from '../lib/notificationRoute';

function useNotificationObserver() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    function redirect(notification: Notifications.Notification) {
      const destination = notificationRoute(notification.request.content.data);
      if (!destination) return;
      router.replace(destination);
      Notifications.clearLastNotificationResponse();
    }

    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) redirect(response.notification);

    const subscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      redirect(nextResponse.notification);
    });

    return () => {
      subscription.remove();
    };
  }, []);
}

export default function RootLayout() {
  useNotificationObserver();

  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <ThemeProvider><AppProviders /></ThemeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}

function AppProviders() {
  const { colors, scheme } = useTheme();
  return (
    <ProProvider>
          <RegionProvider>
            <WatchlistProvider>
              <ProductsProvider>
                <PriceMonitorRegistration />
                <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="product/[skuId]" />
                  <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="privacy" />
                </Stack>
              </ProductsProvider>
            </WatchlistProvider>
          </RegionProvider>
    </ProProvider>
  );
}
