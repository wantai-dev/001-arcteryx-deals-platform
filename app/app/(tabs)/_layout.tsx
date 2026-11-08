import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePreferences } from '../../contexts/PreferencesContext';
import { useTheme } from '../../contexts/ThemeContext';
import { scaleLength } from '../../lib/typeScale';

export default function TabsLayout() {
  const { t } = usePreferences();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // A fixed 78/20 bar leaves dead space on devices without a home indicator and
  // crowds the indicator on the ones that have it. The bar also has to grow for
  // the larger text sizes, or the scaled labels clip against the icons.
  const barHeight = scaleLength(50, fontScale) + insets.bottom;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          height: barHeight,
          paddingTop: 6,
          paddingBottom: insets.bottom || 6,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
        // Tab labels scale with the system text size; the bar grows to match.
        tabBarAllowFontScaling: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.deals'),
          tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="yearbook"
        options={{
          title: t('tabs.yearbook'),
          tabBarIcon: ({ color, size }) => <Ionicons name="library-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: t('tabs.watchlist'),
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: t('tabs.me'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
