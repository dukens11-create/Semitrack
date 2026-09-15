import { Store } from '../../state/Store';
import type { Coordinate } from '../../models/contracts';
import type { Stop } from '../stops/StopPlan';
import type { SearchService } from './SearchService';
import type { PoiService, Poi, PlaceCategory } from '../poi/PoiService';
export type DestinationSearchState = {
  query: string;
  phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  results: Stop[];
  pois: Poi[];
  error?: string;
};
export class DestinationSearchStore extends Store<DestinationSearchState> {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  constructor(private search: SearchService, private poi: PoiService) {
    super({ query: '', phase: 'idle', results: [], pois: [] });
  }
  cancel() {
    ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    this.publish({
      query: this.value.query,
      phase: 'idle',
      results: [],
      pois: [],
    });
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
  searchNow(center?: Coordinate) {
    if (this.value.phase === 'loading') return Promise.resolve();
    return this.execute(async signal => ({
      results: await this.search.search(this.value.query, center, signal),
      pois: [],
    }));
  }
  nearby(category: PlaceCategory, center: Coordinate) {
    return this.execute(async signal => ({
      results: [],
      pois: await this.poi.nearby(category, center, signal),
    }));
  }
  reverse(point: Coordinate) {
    return this.execute(async signal => ({
      results: await this.search.reverse(point, signal),
      pois: [],
    }));
  }
  private async execute(
    action: (signal: AbortSignal) => Promise<{ results: Stop[]; pois: Poi[] }>,
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
    } catch {
      if (generation === this.generation)
        this.publish({
          ...this.value,
          phase: 'error',
          error: 'Places could not be loaded. Check your connection and retry.',
        });
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}
