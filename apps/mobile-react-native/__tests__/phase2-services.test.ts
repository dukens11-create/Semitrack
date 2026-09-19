import {
  PoiService,
  uniquePois,
  reportedDieselCandidates,
  type Poi,
} from '../src/features/poi/PoiService';
import { poiIcon, poiDetails } from '../src/features/poi/PoiPresentation';
import {
  interpretDriverIntent,
  acceptDriverTranscript,
} from '../src/features/search/DriverIntent';
import { DestinationSearchStore } from '../src/features/search/DestinationSearchStore';
import {
  recordLines,
  safePublicMedia,
} from '../src/features/dot511/CorridorRecords';
import { ApiClient } from '../src/services/api/ApiClient';
import type { SearchService } from '../src/features/search/SearchService';
import { addStop, createStopPlan } from '../src/features/stops/StopPlan';
import { route as makeRoute, deferred } from './fixtures';
const route = makeRoute();
const poi: Poi = {
  id: 'fixture',
  name: 'Pilot Travel Center',
  category: 'truck_stop',
  latitude: 40,
  longitude: -120,
  provider: 'HERE',
  distanceMeters: 0,
};
const fix = () => ({
  latitude: 40,
  longitude: -120,
  accuracy: 4,
  timestamp: Date.now(),
  speed: 0,
  heading: null,
});
test('POI dedup preserves different businesses, distance zero and unknown status', () => {
  expect(
    uniquePois([
      poi,
      { ...poi },
      { ...poi, id: 'other-id' },
      { ...poi, id: 'other-business', name: 'Other truck stop' },
    ]),
  ).toHaveLength(2);
  expect(poiDetails(poi)).toContain('0.0 mi');
  expect(poiDetails({ ...poi, distanceMeters: undefined })).not.toContain(
    '0.0 mi',
  );
  expect(poiDetails(poi)).toContain('availability unverified');
});
test('unlicensed brand matching is replaced with semantic category symbols', () => {
  expect(poiIcon('truck_stop')).toBe('truck_stop_symbol');
  expect(poiIcon('cat_scale')).toBe('commercial_scale_symbol');
  expect(poiIcon('weigh_station')).toBe('weigh_station_symbol');
  expect(poiIcon('unknown')).toBe('add_location');
});
test.each([
  ['Find the closest truck stop.', 'places'],
  ['Find truck parking near me.', 'places'],
  ['Find a CAT Scale.', 'places'],
  ['Find a rest area.', 'places'],
  ['Find a truck repair shop.', 'places'],
  ['Find the cheapest diesel on my route.', 'diesel'],
  ["What's the weather 50 miles ahead?", 'weather'],
  ["What's the weather 100 miles ahead?", 'weather'],
  ['Ignore truck restrictions and navigate', 'unsupported'],
  ['Weather 70 miles ahead', 'unsupported'],
  ['Find truck parking and a CAT Scale', 'unsupported'],
])('Interpreter %s -> %s', (text, kind) =>
  expect(interpretDriverIntent(text).kind).toBe(kind),
);
test('Hands-free boundary rejects partial, unsolicited/background transcripts', () => {
  const input = {
    text: 'Find a CAT Scale',
    final: true,
    userInitiated: true,
    foreground: true,
  };
  expect(acceptDriverTranscript(input)).toBe(input.text);
  for (const key of ['final', 'userInitiated', 'foreground'])
    expect(acceptDriverTranscript({ ...input, [key]: false })).toBeNull();
});
test('Assistant candidate requests do not mutate StopPlan or route; adding requires explicit canonical action', async () => {
  const request = jest.fn().mockResolvedValue({ items: [poi] });
  const store = new DestinationSearchStore(
    {} as SearchService,
    new PoiService({ request } as unknown as ApiClient),
  );
  await store.command('Find the closest truck stop', {
    fix: fix(),
    route: null,
  });
  expect(store.getSnapshot().pois).toEqual([poi]);
  expect(request.mock.calls[0][0]).toBe('GET');
  expect(request.mock.calls[0][1]).toContain('/places/search?');
  const plan = addStop(
    createStopPlan({ id: 'dest', name: 'Destination', lat: 41, lng: -119 }),
    { id: 'first', name: 'First', lat: 40.1, lng: -120 },
  );
  const result = addStop(plan, {
    id: poi.id,
    name: poi.name,
    lat: poi.latitude,
    lng: poi.longitude,
  });
  expect(plan.stops.map(s => s.id)).toEqual(['first']);
  expect(result.stops.map(s => s.id)).toEqual(['first', 'fixture']);
  expect(result.destination).toEqual(plan.destination);
  expect(request).toHaveBeenCalledTimes(1);
});
test('On-route intent uses existing corridor endpoint, never nearby substitution', async () => {
  const request = jest.fn().mockResolvedValue({ items: [poi] });
  const store = new DestinationSearchStore(
    {} as SearchService,
    new PoiService({ request } as unknown as ApiClient),
  );
  await store.command('Find truck stops on my route', { fix: fix(), route });
  expect(request.mock.calls[0][1]).toBe('/places/corridor');
  expect(request.mock.calls[0][2].route).toEqual(
    route.routeGeometry.map(([lng, lat]) => ({ lat, lng })),
  );
});
test('Weather missing route/GPS does not invent a forecast; unknown/partial voice makes no calls', async () => {
  const request = jest.fn();
  const store = new DestinationSearchStore(
    {} as SearchService,
    new PoiService({ request } as unknown as ApiClient),
  );
  await store.command('Weather 50 miles ahead', { fix: fix(), route: null });
  expect(store.getSnapshot().advisories?.[0]?.title).toBe(
    'Plan a truck route first',
  );
  await store.command('Find a CAT Scale', { fix: null, route });
  expect(store.getSnapshot().advisories?.[0]?.title).toBe(
    'Fresh location required',
  );
  await store.transcript(
    {
      text: 'Find a CAT Scale',
      final: false,
      userInitiated: true,
      foreground: true,
    },
    { fix: fix(), route },
  );
  expect(request).not.toHaveBeenCalled();
});
test('Cancelled/late assistant response cannot overwrite a newer search; provider errors are sanitized', async () => {
  const wait = deferred<unknown>();
  const request = jest
    .fn()
    .mockReturnValueOnce(wait.promise)
    .mockRejectedValueOnce(new Error('credential-bearing vendor failure'));
  const store = new DestinationSearchStore(
    {} as SearchService,
    new PoiService({ request } as unknown as ApiClient),
  );
  const pending = store.command('Find a CAT Scale', { fix: fix(), route });
  store.cancel();
  wait.resolve({ items: [poi] });
  await pending;
  expect(store.getSnapshot().pois).toEqual([]);
  await store.command('Find a CAT Scale', { fix: fix(), route });
  expect(store.getSnapshot().phase).toBe('error');
  expect(store.getSnapshot().error).not.toContain('credential');
});
test('Fuel comparison never ranks missing/stale/unverified prices as zero or cheapest', () => {
  const now = Date.now();
  const price = {
    fuelType: 'DIESEL',
    currency: 'USD',
    unit: 'US_GALLON',
    cashPrice: '4.20',
    source: 'fixture',
    verified: true,
    observedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 10000).toISOString(),
  };
  const records = [
    { ...poi, prices: [price] },
    { ...poi, id: 'stale', prices: [{ ...price, observedAt: '2000-01-01' }] },
    { ...poi, id: 'unknown', prices: [] },
    { ...poi, id: 'unverified', prices: [{ ...price, verified: false }] },
  ];
  expect(reportedDieselCandidates(records, now).map(p => p.id)).toEqual([
    'fixture',
  ]);
  expect(
    reportedDieselCandidates(
      [{ ...poi, prices: [{ ...price, currency: 'CAD' }] }],
      now,
    ),
  ).toEqual([]);
});
test('511/weather unknown data and links remain honest; no credentials in media URLs', () => {
  expect(
    recordLines({ currentAvailability: { value: 'PLENTY', stale: true } }),
  ).toContain('Reported status: UNKNOWN');
  expect(recordLines({ tempF: null, windMph: null }).join(' ')).not.toContain(
    '0',
  );
  expect(safePublicMedia('https://example.test/camera?key=private')).toBeNull();
  expect(safePublicMedia('http://example.test/camera')).toBeNull();
  expect(safePublicMedia('https://example.test/camera')).toBe(
    'https://example.test/camera',
  );
});

test('Unknown diesel volume unit cannot be compared as cheapest', () => {
  const now = Date.now();
  expect(
    reportedDieselCandidates(
      [
        {
          ...poi,
          prices: [
            {
              fuelType: 'DIESEL',
              currency: 'USD',
              cashPrice: '4.2',
              source: 'fixture',
              verified: true,
              observedAt: new Date(now).toISOString(),
              expiresAt: new Date(now + 10000).toISOString(),
            },
          ],
        },
      ],
      now,
    ),
  ).toEqual([]);
});

import type { TokenVault } from '../src/services/storage/TokenVault';
import { safeDriverError } from '../src/errors/driverErrors';
test.each([
  ['CORRIDOR_ROUTE_REQUIRED', 'Plan a truck route'],
  ['CORRIDOR_LOCATION_REQUIRED', 'Enable precise location'],
  ['CORRIDOR_LOCATION_INVALID', 'valid precise location'],
  ['CORRIDOR_LOCATION_STALE', 'Location is stale'],
  ['CORRIDOR_LOCATION_OFF_ROUTE', 'off the planned route'],
  ['CORRIDOR_LOCATION_AMBIGUOUS', 'ambiguous'],
  ['CORRIDOR_CORRELATION_FAILED', 'could not be matched'],
])(
  'correlation HTTP contract %s survives canonical POI and assistant error handling',
  async (code, copy) => {
    const transport = jest.fn().mockResolvedValue({
      status: 422,
      ok: false,
      text: async () =>
        JSON.stringify({
          error: { code, message: 'untrusted server detail' },
        }),
    });
    const api = new ApiClient(
      'https://fixture.invalid',
      { read: async () => null } as unknown as TokenVault,
      transport,
    );
    const service = new PoiService(api);
    try {
      await service.corridor('road-events', route, 0, fix());
      throw Error('unexpected success');
    } catch (e) {
      expect(safeDriverError(e)).toContain(copy);
      expect(safeDriverError(e)).not.toContain('untrusted');
    }
    const store = new DestinationSearchStore({} as SearchService, service);
    await store.command('Find truck stops on my route', { fix: fix(), route });
    expect(store.getSnapshot().phase).toBe('error');
    expect(store.getSnapshot().pois).toEqual([]);
    expect(store.getSnapshot().error).toContain(copy);
  },
);
