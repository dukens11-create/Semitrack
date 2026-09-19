import type { Settings } from './SettingsService';
export function mapPreferences(settings: Settings | null | undefined) {
  const raw = settings?.settingsJson?.rnMap;
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    satellite: value.satellite === true,
    autoZoom: value.autoZoom !== false,
  };
}
