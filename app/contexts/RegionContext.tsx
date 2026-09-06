import { PropsWithChildren, useMemo } from 'react';
import { usePreferences } from './PreferencesContext';
export const LEGACY_REGION_STORAGE_KEY = 'geardrop.region.v1';
export function RegionProvider({ children }: PropsWithChildren) { return children; }
export function useRegion() { const { region, currency, setMarket } = usePreferences(); return useMemo(() => ({ region, setRegion: (next: string) => setMarket({ region: next, currency }) }), [currency, region, setMarket]); }
