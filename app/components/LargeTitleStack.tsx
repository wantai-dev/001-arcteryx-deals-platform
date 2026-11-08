import { Stack } from "expo-router";

import { useTheme } from "../contexts/ThemeContext";

/**
 * Per-tab native stack so iOS renders a real large title that collapses into an
 * inline title on scroll. The bottom-tab navigator's own header is a JS header
 * and cannot do this, so each tab that wants a large title owns a stack.
 *
 * Screens set their own `title` and `headerRight` with `<Stack.Screen options>`.
 * The header is opaque rather than transparent: a transparent header only gets
 * its content inset back through `contentInsetAdjustmentBehavior`, which is
 * iOS-only, so on web and Android the content would start underneath the bar.
 */
export function LargeTitleStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTintColor: colors.ink as string,
        headerLargeTitleStyle: { color: colors.ink as string },
        headerTitleStyle: { color: colors.ink as string },
        headerStyle: { backgroundColor: colors.screen as string },
        contentStyle: { backgroundColor: colors.screen },
      }}
    />
  );
}
