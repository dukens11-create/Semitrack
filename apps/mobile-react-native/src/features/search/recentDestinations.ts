import type { Settings, SettingsService } from '../settings/SettingsService';
// Retain driver-entered text only. Mapbox temporary result coordinates/names are not cached.
export function recentDestinations(
  settings: Settings | null,
  filter = '',
): string[] {
  const raw = settings?.settingsJson?.rnRecentDestinations;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(
      (v): v is string =>
        typeof v === 'string' && v.trim().length >= 3 && v.length <= 256,
    )
    .filter(v => {
      const key = v.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return key.includes(filter.trim().toLowerCase());
    })
    .slice(0, 100);
}
export function addRecent(items: string[], text: string) {
  const query = text.trim();
  if (query.length < 3 || query.length > 256) return items;
  return [
    query,
    ...items.filter(v => v.toLowerCase() !== query.toLowerCase()),
  ].slice(0, 100);
}
export async function saveRecent(
  service: SettingsService,
  update: (items: string[]) => string[],
) {
  const settings = await service.load();
  if (!settings) throw new Error('Preferences unavailable');
  await service.save({
    ...settings,
    settingsJson: {
      ...settings.settingsJson,
      rnRecentDestinations: update(recentDestinations(settings)),
    },
  });
}
