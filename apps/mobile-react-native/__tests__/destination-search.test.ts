import { SearchService } from '../src/features/search/SearchService';
import { DestinationSearchStore } from '../src/features/search/DestinationSearchStore';
import type { PoiService } from '../src/features/poi/PoiService';
import type { Stop } from '../src/features/stops/StopPlan';
import { deferred } from './fixtures';
const place: Stop = {
  id: 'fixture-place',
  name: 'Fixture address',
  lat: 40,
  lng: -100,
};
const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-100, 40] },
  properties: {
    mapbox_id: 'provider-id',
    name: 'Fixture',
    full_address: 'Fixture address',
  },
};
function transport(data: unknown = { features: [feature] }) {
  return jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => data,
    }) as jest.MockedFunction<typeof fetch>;
}
test('v6 response accepts documented mapbox_id and sends lon/lat proximity only when available', async () => {
  const fetcher = transport();
  const service = new SearchService('pk.fixture.public', fetcher);
  expect(await service.search('address')).toEqual([
    { id: 'provider-id', name: 'Fixture address', lat: 40, lng: -100 },
  ]);
  const first = new URL(String(fetcher.mock.calls[0]![0]));
  expect(first.searchParams.has('proximity')).toBe(false);
  expect(first.searchParams.get('autocomplete')).toBe('true');
  expect(first.searchParams.get('country')).toBe('us,ca,mx');
  expect(first.searchParams.has('permanent')).toBe(false);
  await service.search('address', { lat: 40, lng: -100 });
  expect(
    new URL(String(fetcher.mock.calls[1]![0])).searchParams.get('proximity'),
  ).toBe('-100,40');
});

test('destination search includes Mexico in provider country scope', async () => {
  const fetcher = transport();
  const service = new SearchService('pk.fixture.public', fetcher);
  await service.search('Walmart Monterrey Nuevo Leon');
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.searchParams.get('country')).toBe('us,ca,mx');
});

test('destination search deduplicates repeated provider identities', async () => {
  const duplicate = {
    ...feature,
    properties: { ...feature.properties, full_address: 'Duplicate rendering' },
  };
  const fetcher = transport({ features: [feature, duplicate] });
  const service = new SearchService('pk.fixture.public', fetcher);
  const results = await service.search('address');
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe('provider-id');
});

test('explicit distant locality remains in the provider query even when a nearby center exists', async () => {
  const fetcher = transport();
  const service = new SearchService('pk.fixture.public', fetcher);
  await service.search('Walmart Monterrey Nuevo Leon', {
    lat: 39.5296,
    lng: -119.8138,
  });
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.searchParams.get('q')).toBe('Walmart Monterrey Nuevo Leon');
  expect(url.searchParams.get('proximity')).toBe('-119.8138,39.5296');
  expect(url.searchParams.get('country')).toBe('us,ca,mx');
});

test('reverse geocodes exact selected map coordinate, no fabricated address on empty response', async () => {
  const fetcher = transport({ features: [] });
  const service = new SearchService('pk.fixture.public', fetcher);
  expect(await service.reverse({ lat: 40, lng: -100 })).toEqual([]);
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.pathname).toBe('/search/geocode/v6/reverse');
  expect(url.searchParams.get('latitude')).toBe('40');
  expect(url.searchParams.get('longitude')).toBe('-100');
});
test('invalid provider coordinates fail closed and credential-bearing transport errors are sanitized', async () => {
  const fetcher = transport({
    features: [
      { ...feature, geometry: { type: 'Point', coordinates: [200, 40] } },
    ],
  });
  const service = new SearchService('pk.fixture.public', fetcher);
  await expect(service.search('address')).rejects.toThrow(
    'Address search is unavailable',
  );
  fetcher.mockRejectedValueOnce(
    new Error('URL access_token=pk.fixture.public failed'),
  );
  await expect(service.search('address')).rejects.toThrow(
    'Address search is unavailable',
  );
});
test('rejects secret token and malformed or oversized query before network', async () => {
  const fetcher = transport();
  await expect(
    new SearchService('sk.fixture.secret', fetcher).search('address'),
  ).rejects.toThrow('public map token');
  const service = new SearchService('pk.fixture.public', fetcher);
  await expect(service.search('bad;address')).rejects.toThrow(
    'without semicolons',
  );
  await expect(service.search('x'.repeat(257))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
function setup() {
  const search = {
    search: jest.fn().mockResolvedValue([place]),
    reverse: jest.fn().mockResolvedValue([place]),
  };
  const poi = { nearby: jest.fn().mockResolvedValue([]) };
  return {
    search,
    poi,
    store: new DestinationSearchStore(
      search as unknown as SearchService,
      poi as unknown as PoiService,
    ),
  };
}
afterEach(() => jest.useRealTimers());
test('debounces typing and cancels when text is cleared', async () => {
  jest.useFakeTimers();
  const { store, search } = setup();
  store.schedule('Ren');
  await jest.advanceTimersByTimeAsync(200);
  store.schedule('Reno');
  await jest.advanceTimersByTimeAsync(399);
  expect(search.search).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(search.search).toHaveBeenCalledTimes(1);
  expect(search.search).toHaveBeenCalledWith(
    'Reno',
    undefined,
    expect.any(AbortSignal),
  );
  store.schedule('Sacramento');
  store.schedule('');
  await jest.advanceTimersByTimeAsync(500);
  expect(search.search).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().results).toEqual([]);
});
test('a new address query starts even while the canceled prior request has not settled', async () => {
  const { store, search } = setup();
  const old = deferred<Stop[]>();
  search.search
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([{ ...place, id: 'new-place', name: 'New address' }]);

  store.schedule('Old address');
  const first = store.searchNow();
  const firstSignal = search.search.mock.calls[0]![2];

  store.schedule('New address');
  const second = store.searchNow();
  await second;

  expect(firstSignal.aborted).toBe(true);
  expect(search.search).toHaveBeenCalledTimes(2);
  expect(search.search.mock.calls[1]![0]).toBe('New address');
  expect(store.getSnapshot().results[0]?.id).toBe('new-place');

  old.resolve([place]);
  await first;
  expect(store.getSnapshot().results[0]?.id).toBe('new-place');
});

test('old address result cannot replace a newer POI request even if transport ignores abort', async () => {
  const { store, search, poi } = setup();
  const old = deferred<Stop[]>();
  search.search.mockReturnValueOnce(old.promise);
  store.schedule('address');
  const first = store.searchNow();
  const signal = search.search.mock.calls[0]![2];
  poi.nearby.mockResolvedValueOnce([
    { id: 'poi', name: 'Truck stop', latitude: 40, longitude: -100 },
  ]);
  await store.nearby('truck_stop', { lat: 40, lng: -100 });
  old.resolve([place]);
  await first;
  expect(signal.aborted).toBe(true);
  expect(store.getSnapshot().pois[0]?.id).toBe('poi');
  expect(store.getSnapshot().results).toEqual([]);
});
test('closing or switching accounts discards pending results and errors', async () => {
  const { store, search } = setup();
  const pending = deferred<Stop[]>();
  search.search.mockReturnValueOnce(pending.promise);
  store.schedule('address');
  const request = store.searchNow();
  store.cancel();
  pending.reject(new Error('late error'));
  await request;
  expect(store.getSnapshot()).toMatchObject({
    phase: 'idle',
    results: [],
    pois: [],
  });
  expect(store.getSnapshot().error).toBeUndefined();
});
test('search error is retryable without leaking exception data; manual submit avoids duplicate in-flight calls', async () => {
  const { store, search } = setup();
  search.search.mockRejectedValueOnce(new Error('private URL'));
  store.schedule('address');
  await store.searchNow();
  expect(store.getSnapshot().phase).toBe('error');
  expect(store.getSnapshot().error).not.toContain('private');
  const pending = deferred<Stop[]>();
  search.search.mockReturnValueOnce(pending.promise);
  const request = store.searchNow();
  await store.searchNow();
  expect(search.search).toHaveBeenCalledTimes(2);
  pending.resolve([place]);
  await request;
  expect(store.getSnapshot().results).toEqual([place]);
  store.cancel();
});
