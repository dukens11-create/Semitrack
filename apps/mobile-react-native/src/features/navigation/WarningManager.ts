import { currentObservation } from './providerEvidence';
export type RouteWarning = {
  id: string;
  title: string;
  source: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  offset: number;
  expires: number;
  stage: 'ahead' | 'approaching' | 'near';
};
export class WarningManager {
  private warnings: Omit<RouteWarning, 'stage'>[] = [];
  private dismissed = new Set<string>();
  reset() {
    this.warnings = [];
    this.dismissed.clear();
  }
  load(
    items: Record<string, unknown>[],
    requestOffset: number,
    now = Date.now(),
  ) {
    const seen = new Set<string>();
    this.warnings = items.flatMap(item => {
      const id = typeof item.id === 'string' ? item.id : undefined,
        title =
          typeof item.title === 'string'
            ? item.title
            : typeof item.description === 'string'
            ? item.description
            : undefined;
      const source =
        typeof item.source === 'string'
          ? item.source
          : typeof item.provider === 'string'
          ? item.provider
          : undefined;
      const ahead = item.routeDistanceAheadMeters;
      if (
        !currentObservation(item, 300000, now) ||
        !id ||
        !title ||
        !source ||
        seen.has(id) ||
        typeof ahead !== 'number' ||
        !Number.isFinite(ahead) ||
        ahead < 0
      )
        return [];
      seen.add(id);
      const end = Date.parse(String(item.endsAt ?? item.expiresAt ?? ''));
      const expires = Math.min(
        now + 300000,
        Date.parse(
          String(
            item.observedAt ??
              item.lastReportedAt ??
              item.lastUpdated ??
              item.updatedAt,
          ),
        ) + 300000,
        Number.isFinite(end) ? end : Infinity,
      );
      if (expires <= now) return [];
      const severity: RouteWarning['severity'] = [
        'CRITICAL',
        'SEVERE',
        'HIGH',
      ].includes(String(item.severity))
        ? 'HIGH'
        : ['MODERATE', 'MEDIUM'].includes(String(item.severity))
        ? 'MEDIUM'
        : 'LOW';
      return [
        { id, title, source, severity, offset: requestOffset + ahead, expires },
      ];
    });
  }
  dismiss(id: string, confirmed = false) {
    if (confirmed || this.warnings.find(w => w.id === id)?.severity !== 'HIGH')
      this.dismissed.add(id);
  }
  visible(offset: number, now = Date.now()): RouteWarning[] {
    return this.warnings
      .filter(
        w =>
          w.expires > now &&
          w.offset >= offset - 25 &&
          w.offset - offset <= 16093 &&
          !this.dismissed.has(w.id),
      )
      .map(w => ({
        ...w,
        stage:
          w.offset - offset <= 300
            ? ('near' as const)
            : w.offset - offset <= 1609
            ? ('approaching' as const)
            : ('ahead' as const),
      }))
      .sort(
        (a, b) =>
          ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity] -
            { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity] || a.offset - b.offset),
      );
  }
}
