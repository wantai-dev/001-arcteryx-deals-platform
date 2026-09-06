import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { usePreferences } from '../../contexts/PreferencesContext';
import { useTheme } from '../../contexts/ThemeContext';

export default function TabsLayout() {
  const { t } = usePreferences();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          height: 78,
          paddingTop: 8,
          paddingBottom: 20,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
        },
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
