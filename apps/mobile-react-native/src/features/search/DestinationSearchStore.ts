import { safeDriverError } from '../../errors/driverErrors';
import { interpretDriverIntent, acceptDriverTranscript } from './DriverIntent';
import { reportedDieselCandidates } from '../poi/PoiService';
import type { TruckRoute } from '../../models/contracts';
import type { LocationFix } from '../../services/location/LocationService';
import { Store } from '../../state/Store';
import type { Coordinate } from '../../models/contracts';
import type { Stop } from '../stops/StopPlan';
import type { SearchService } from './SearchService';
import type { PoiService, Poi, PlaceCategory } from '../poi/PoiService';
export type DestinationSearchState = {
  query: string;
  recentQueries?: string[];
  phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  results: Stop[];
  pois: Poi[];
  error?: string;
  advisories?: Record<string, unknown>[];
};
export class DestinationSearchStore extends Store<DestinationSearchState> {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private searchInFlight: object | null = null;
  constructor(private search: SearchService, private poi: PoiService) {
    super({ query: '', phase: 'idle', results: [], pois: [] });
  }
  cancel() {
    ++this.generation;
    this.searchInFlight = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    this.publish({
      query: this.value.query,
      recentQueries: this.value.recentQueries,
      phase: 'idle',
      results: [],
      pois: [],
    });
  }
  clear() {
    this.cancel();
    this.publish({
      query: '',
      phase: 'idle',
      results: [],
      pois: [],
      recentQueries: this.value.recentQueries,
    });
  }
  clearRecent() {
    this.publish({ ...this.value, recentQueries: [] });
  }
  schedule(query: string, center?: Coordinate) {
    this.cancel();
    this.publish({
      ...this.value,
      query,
      phase: query.trim().length >= 3 ? 'waiting' : 'idle',
    });
    if (query.trim().length >= 3)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.searchNow(center);
      }, 400);
  }
  async searchNow(center?: Coordinate) {
    if (this.searchInFlight) return;

    const query = this.value.query.trim();
    if (query.length < 3) return;

    const pending = this.execute(async signal => ({
      results: await this.search.search(query, center, signal),
      pois: [],
      recentQueries: [
        query,
        ...(this.value.recentQueries ?? []).filter(
          value => value.toLowerCase() !== query.toLowerCase(),
        ),
      ]
        .filter(Boolean)
        .slice(0, 5),
    }));
    const owner = {};
    this.searchInFlight = owner;
    try {
      await pending;
    } finally {
      if (this.searchInFlight === owner) this.searchInFlight = null;
    }
  }
  nearby(category: PlaceCategory, center: Coordinate) {
    return this.execute(async signal => ({
      results: [],
      pois: await this.poi.nearby(category, center, signal),
    }));
  }
  alongRoute(category: PlaceCategory, route: TruckRoute, fix: LocationFix) {
    return this.execute(async signal => ({
      results: [],
      pois: await this.poi.alongRoute(category, route, fix, signal),
    }));
  }
  reverse(point: Coordinate) {
    return this.execute(async signal => ({
      results: await this.search.reverse(point, signal),
      pois: [],
    }));
  }
  command(
    text: string,
    context: { fix: LocationFix | null; route: TruckRoute | null },
  ) {
    return this.execute(async signal => {
      const intent = interpretDriverIntent(text);
      if (intent.kind === 'unsupported')
        return {
          results: [],
          pois: [],
          advisories: [
            {
              title: 'Request not supported',
              description:
                'Ask for a truck place, reported diesel prices on your route, or weather current/50 miles/100 miles/destination. No route has changed.',
            },
          ],
        };
      const fix = context.fix;
      if (
        !fix ||
        Date.now() - fix.timestamp > 15000 ||
        fix.timestamp > Date.now() + 5000 ||
        fix.accuracy > 100
      )
        return {
          results: [],
          pois: [],
          advisories: [
            {
              title: 'Fresh location required',
              description:
                'Enable precise location and retry. No location is assumed.',
            },
          ],
        };
      if (intent.kind === 'places') {
        if (intent.onRoute && !context.route)
          return {
            results: [],
            pois: [],
            advisories: [{ title: 'Plan a truck route first' }],
          };
        return {
          results: [],
          pois: intent.onRoute
            ? await this.poi.alongRoute(
                intent.category,
                context.route!,
                fix,
                signal,
              )
            : await this.poi.nearby(
                intent.category,
                { lat: fix.latitude, lng: fix.longitude },
                signal,
              ),
        };
      }
      if (!context.route)
        return {
          results: [],
          pois: [],
          advisories: [
            {
              title: 'Plan a truck route first',
              description:
                'Ahead/on-route information requires an accepted route.',
            },
          ],
        };
      if (intent.kind === 'weather')
        return {
          results: [],
          pois: [],
          advisories: (
            await this.poi.routeWeather(context.route, fix, signal)
          ).filter(
            item =>
              item.label === intent.label ||
              (item.status === 'UNAVAILABLE' && item.label === 'Route weather'),
          ),
        };
      const pois = reportedDieselCandidates(
        await this.poi.corridor('fuel', context.route, 0, fix, signal),
      );
      return {
        results: [],
        pois,
        advisories: [
          {
            title: 'Reported diesel prices',
            description: pois.length
              ? 'Lowest reported USD cash prices among returned stations only. Confirm price basis and access with the station. Select a result and confirm before changing stops.'
              : 'No fresh verified prices with comparable currency and volume units returned. Cheapest diesel is unknown.',
          },
        ],
      };
    });
  }
  transcript(
    input: Parameters<typeof acceptDriverTranscript>[0],
    context: { fix: LocationFix | null; route: TruckRoute | null },
  ) {
    const text = acceptDriverTranscript(input);
    return text === null ? Promise.resolve() : this.command(text, context);
  }
  private async execute(
    action: (signal: AbortSignal) => Promise<{
      results: Stop[];
      pois: Poi[];
      recentQueries?: string[];
      advisories?: Record<string, unknown>[];
    }>,
  ) {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ ...this.value, phase: 'loading' });
    try {
      const result = await action(controller.signal);
      if (generation === this.generation)
        this.publish({ ...this.value, ...result, phase: 'ready' });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          ...this.value,
          phase: 'error',
          error: safeDriverError(
            error,
            'Places could not be loaded. Check your connection and retry.',
          ),
        });
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}
