import { createContext, PropsWithChildren, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeColors, themeColors } from '../lib/theme';
import { usePreferences } from './PreferencesContext';

type Value = { colors: ThemeColors; scheme: 'light' | 'dark' };
const Context = createContext<Value | null>(null);
export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme(); const { appearance } = usePreferences();
  const scheme = appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance;
  const value = useMemo(() => ({ scheme, colors: themeColors(scheme) }), [scheme]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTheme() { const value = useContext(Context); if (!value) throw new Error('useTheme must be used inside ThemeProvider'); return value; }
