import { usePreferences } from './PreferencesContext';
export function useMarket() { const { region, currency, setMarket, hydrated } = usePreferences(); return { region, currency, setMarket, hydrated }; }
