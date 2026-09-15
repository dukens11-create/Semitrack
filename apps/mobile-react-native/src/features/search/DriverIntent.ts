import type { PlaceCategory } from '../poi/PoiService';
export type DriverIntent =
  | { kind: 'places'; category: PlaceCategory; onRoute: boolean }
  | { kind: 'weather'; label: string }
  | { kind: 'diesel' }
  | { kind: 'unsupported' };
export function interpretDriverIntent(text: string): DriverIntent {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[?!.,]/g, '');
  // Reject compound/negated requests; do not silently reinterpret safety instructions.
  if (
    value.length > 256 ||
    /\b(and|then|not|don't|avoid|navigate|start|ignore)\b/.test(value)
  )
    return { kind: 'unsupported' };
  if (/weather/.test(value)) {
    if (
      !/^(?:(?:what's|what is|show) (?:the )?)?(?:current )?weather (?:50 miles? ahead|100 miles? ahead|(?:near |at )?(?:my |the )?destination|here|now)$/.test(
        value,
      )
    )
      return { kind: 'unsupported' };
    if (/\b50\s+miles?\s+ahead\b/.test(value))
      return { kind: 'weather', label: '50 miles ahead' };
    if (/\b100\s+miles?\s+ahead\b/.test(value))
      return { kind: 'weather', label: '100 miles ahead' };
    if (/\bdestination\b/.test(value))
      return { kind: 'weather', label: 'Destination' };
    if (/\b(current|here|now)\b/.test(value))
      return { kind: 'weather', label: 'Current route location' };
    return { kind: 'unsupported' };
  }
  if (
    /^(?:find |show )?(?:the )?cheapest diesel on (?:my|the) route$/.test(value)
  )
    return { kind: 'diesel' };
  const categories: [RegExp, PlaceCategory][] = [
    [/\bcat\s+scale\b/, 'cat_scale'],
    [/\btruck\s+parking\b/, 'truck_parking'],
    [/\btruck\s+stops?\b/, 'truck_stop'],
    [/\brest\s+area\b/, 'rest_area'],
    [/\btruck\s+repair\b/, 'truck_repair'],
    [/\btruck\s+wash\b/, 'truck_wash'],
    [/\bweigh\s+station\b/, 'weigh_station'],
    [/\btruck\s+fuel\b/, 'fuel_stop'],
  ];
  const matches = categories.filter(([pattern]) => {
    if (!pattern.test(value)) return false;
    const remainder = value.replace(pattern, '').trim().replace(/\s+/g, ' ');
    return /^(?:(?:find|show) )?(?:the )?(?:closest|nearest|a)?\s*(?:shop\s*)?(?:near me|nearby|on my route|on the route)?$/.test(
      remainder,
    );
  });
  return matches.length === 1
    ? {
        kind: 'places',
        category: matches[0]![1],
        onRoute: /\broute\b/.test(value),
      }
    : { kind: 'unsupported' };
}
/** Future native recognition must supply a final, user-initiated transcript. Never execute partial/background speech. */
export function acceptDriverTranscript(input: {
  text: string;
  final: boolean;
  userInitiated: boolean;
  foreground: boolean;
}): string | null {
  return input.final &&
    input.userInitiated &&
    input.foreground &&
    input.text.trim().length <= 256 &&
    input.text.trim().length > 0
    ? input.text.trim()
    : null;
}
