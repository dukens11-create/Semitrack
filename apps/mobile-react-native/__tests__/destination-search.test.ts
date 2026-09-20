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
    feature_type: 'address',
    name: 'Fixture',
    full_address: 'Fixture address',
  },
};
test('new debounce executes while cancelled request is still pending; stale completion cannot unlock or overwrite it', async () => {
  jest.useFakeTimers();
  try {
    const a = deferred<Stop[]>(),
      b = deferred<Stop[]>();
    const search = jest
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const store = new DestinationSearchStore(
      { search } as unknown as SearchService,
      {} as PoiService,
    );
    store.schedule('first query');
    await jest.advanceTimersByTimeAsync(400);
    const signal = search.mock.calls[0]![2] as AbortSignal;
    store.schedule('second query');
    await jest.advanceTimersByTimeAsync(400);
    expect(signal.aborted).toBe(true);
    expect(search).toHaveBeenCalledTimes(2);
    a.resolve([{ ...place, id: 'stale' }]);
    await Promise.resolve();
    await Promise.resolve();
    void store.searchNow();
    expect(search).toHaveBeenCalledTimes(2);
    b.resolve([{ ...place, id: 'fresh' }]);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().results.map(s => s.id)).toEqual(['fresh']);
    store.cancel();
  } finally {
    jest.useRealTimers();
  }
});
test('nonempty GPS-biased POI cannot bypass an explicit provider-resolved locality', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        suggestions: [
          { ...businessFeature.properties, mapbox_id: 'unrelated' },
        ],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        features: [
          {
            ...businessFeature,
            properties: {
              ...businessFeature.properties,
              mapbox_id: 'unrelated',
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ features: [localityFeature] }))
    .mockResolvedValueOnce(
      jsonResponse({ suggestions: [businessFeature.properties] }),
    )
    .mockResolvedValueOnce(jsonResponse({ features: [businessFeature] }));
  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
    { lat: 40, lng: -110 },
  );
  expect(result.map(s => s.id)).toEqual(['fixture-business']);
});
test('duplicate suggestions retrieve a provider identity only once', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        suggestions: [businessFeature.properties, businessFeature.properties],
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ features: [businessFeature] }));
  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart',
    { lat: 40, lng: -110 },
  );
  expect(result).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
function transport(data: unknown = { features: [feature] }) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  }) as jest.MockedFunction<typeof fetch>;
}
test('forward search works without a center and does not fabricate proximity', async () => {
  const fetcher = transport();
  const service = new SearchService('pk.fixture.public', fetcher);

  expect(await service.search('address')).toEqual([
    { id: 'provider-id', name: 'Fixture address', lat: 40, lng: -100 },
  ]);

  expect(fetcher).toHaveBeenCalledTimes(1);

  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.pathname).toBe('/search/searchbox/v1/forward');
  expect(url.searchParams.get('q')).toBe('address');
  expect(url.searchParams.get('country')).toBe('us,ca,mx');
  expect(url.searchParams.has('proximity')).toBe(false);
  expect(url.searchParams.has('permanent')).toBe(false);
});

test('centered business search uses POI suggest then retrieve with the same session token', async () => {
  const fetcher = jest.fn();

  fetcher
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            mapbox_id: 'poi-walmart',
            feature_type: 'poi',
            name: 'Walmart Supercenter',
            full_address: '2425 E 2nd St, Reno, Nevada 89502, United States',
            place_formatted: 'Reno, Nevada 89502, United States',
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [-119.789, 39.526],
            },
            properties: {
              mapbox_id: 'poi-walmart',
              feature_type: 'poi',
              name: 'Walmart Supercenter',
              full_address: '2425 E 2nd St, Reno, Nevada 89502, United States',
              place_formatted: 'Reno, Nevada 89502, United States',
            },
          },
        ],
      }),
    }) as jest.MockedFunction<typeof fetch>;

  const service = new SearchService('pk.fixture.public', fetcher);

  expect(
    await service.search('Walmart', {
      lat: 39.5296,
      lng: -119.8138,
    }),
  ).toEqual([
    {
      id: 'poi-walmart',
      name: 'Walmart Supercenter - 2425 E 2nd St, Reno, Nevada 89502, United States',
      lat: 39.526,
      lng: -119.789,
    },
  ]);

  expect(fetcher).toHaveBeenCalledTimes(2);

  const suggestUrl = new URL(String(fetcher.mock.calls[0]![0]));
  const retrieveUrl = new URL(String(fetcher.mock.calls[1]![0]));

  expect(suggestUrl.pathname).toBe('/search/searchbox/v1/suggest');
  expect(suggestUrl.searchParams.get('q')).toBe('Walmart');
  expect(suggestUrl.searchParams.get('types')).toBe('poi');
  expect(suggestUrl.searchParams.get('country')).toBe('us,ca,mx');
  expect(suggestUrl.searchParams.get('proximity')).toBe('-119.8138,39.5296');

  expect(retrieveUrl.pathname).toBe(
    '/search/searchbox/v1/retrieve/poi-walmart',
  );

  const suggestSession = suggestUrl.searchParams.get('session_token');
  const retrieveSession = retrieveUrl.searchParams.get('session_token');

  expect(suggestSession).toBeTruthy();
  expect(retrieveSession).toBe(suggestSession);
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
    'Destination search is unavailable',
  );
  fetcher.mockRejectedValueOnce(
    new Error('URL access_token=pk.fixture.public failed'),
  );
  const error = await service.search('address').catch(value => value);
  expect(error).toMatchObject({ code: 'PLACE_SEARCH_NETWORK' });
  expect(error.message).not.toMatch(/access_token|pk\.fixture|URL/);
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

test('Search Box preserves POI business name with its address without claiming truck access', async () => {
  const fetcher = transport({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-119.8, 39.5],
        },
        properties: {
          mapbox_id: 'poi-walmart',
          feature_type: 'poi',
          name: 'Walmart Supercenter',
          full_address: 'Fixture Walmart address',
        },
      },
    ],
  });

  const service = new SearchService('pk.fixture.public', fetcher);

  expect(await service.search('Walmart Reno NV')).toEqual([
    {
      id: 'poi-walmart',
      name: 'Walmart Supercenter - Fixture Walmart address',
      lat: 39.5,
      lng: -119.8,
    },
  ]);

  const url = new URL(String(fetcher.mock.calls[0]![0]));

  expect(url.pathname).toBe('/search/searchbox/v1/forward');
  expect(url.searchParams.get('q')).toBe('Walmart Reno NV');
  expect(url.searchParams.get('country')).toBe('us,ca,mx');
});

// Synthetic public-locality fixtures, never device/user location.
const localityFeature = {
  ...feature,
  geometry: { type: 'Point', coordinates: [-119.8138, 39.5296] },
  properties: {
    mapbox_id: 'fixture-city',
    feature_type: 'place',
    name: 'Reno',
    context: {
      region: { name: 'Nevada', region_code: 'NV' },
      country: { name: 'United States', country_code: 'US' },
    },
  },
};
const businessFeature = {
  ...feature,
  geometry: { type: 'Point', coordinates: [-119.789, 39.526] },
  properties: {
    mapbox_id: 'fixture-business',
    feature_type: 'poi',
    name: 'Walmart Supercenter',
    address: '2425 E 2nd St',
    place_formatted: 'Reno, NV',
  },
};
const jsonResponse = (data: unknown) =>
  ({ ok: true, json: async () => data } as Response);
function businessTransport() {
  return jest.fn(async (input: RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/suggest'))
      return jsonResponse({ suggestions: [businessFeature.properties] });
    if (url.pathname.includes('/retrieve/'))
      return jsonResponse({ features: [businessFeature] });
    return jsonResponse({ features: [localityFeature] });
  });
}
test('business plus locality without device center resolves locality then suggests/retrieves business in one session', async () => {
  const fetcher = businessTransport();
  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );
  expect(result).toEqual([
    {
      id: 'fixture-business',
      name: 'Walmart Supercenter - 2425 E 2nd St, Reno, NV',
      lng: -119.789,
      lat: 39.526,
    },
  ]);
  const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
  expect(urls.map(url => url.pathname)).toEqual([
    '/search/searchbox/v1/forward',
    '/search/searchbox/v1/forward',
    '/search/searchbox/v1/suggest',
    '/search/searchbox/v1/retrieve/fixture-business',
  ]);
  expect(urls[0]!.searchParams.get('q')).toBe('Walmart Reno NV');
  expect(urls[1]!.searchParams.get('q')).toBe('Reno NV');
  expect(urls[1]!.searchParams.get('types')).toBe('place,locality');
  expect(urls[0]!.searchParams.has('proximity')).toBe(false);
  expect(urls[1]!.searchParams.has('proximity')).toBe(false);
  expect(urls[2]!.searchParams.get('q')).toBe('Walmart');
  expect(urls[2]!.searchParams.get('proximity')).toBe('-119.8138,39.5296');
  expect(urls[2]!.searchParams.get('session_token')).toBeTruthy();
  expect(urls[3]!.searchParams.get('session_token')).toBe(
    urls[2]!.searchParams.get('session_token'),
  );
  for (const url of urls.slice(0, 3))
    expect(url.searchParams.get('country')).toBe('us,ca,mx');
  expect(Object.keys(result[0]!).sort()).toEqual(['id', 'lat', 'lng', 'name']);
});

test.each([
  ['Pilot', 'Phoenix', 'AZ', 'Arizona', 'US'],
  ['TA', 'Ontario', 'CA', 'California', 'US'],
  ["Love's", 'Dallas', 'TX', 'Texas', 'US'],
  ['Costco', 'Las Vegas', 'NV', 'Nevada', 'US'],
  ['North Star Hardware', 'QuÃ©bec', 'QC', 'QuÃ©bec', 'CA'],
  ['Mercado Azul', 'San Luis PotosÃ­', 'SLP', 'San Luis PotosÃ­', 'MX'],
])(
  'provider-backed split handles %s / %s without a local brand or city list',
  async (term, city, code, region, country) => {
    const query = `${term} ${city} ${code}`;
    const locality = {
      ...localityFeature,
      properties: {
        ...localityFeature.properties,
        name: city,
        context: {
          region: { name: region, region_code: code },
          country: { country_code: country },
        },
      },
    };
    const business = {
      ...businessFeature,
      properties: {
        ...businessFeature.properties,
        name: term,
        full_address: 'Provider street and locality',
      },
    };
    const fetcher = jest.fn(async (input: RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/suggest'))
        return jsonResponse({ suggestions: [business.properties] });
      if (url.pathname.includes('/retrieve/'))
        return jsonResponse({ features: [business] });
      return jsonResponse({ features: [locality] });
    });
    const results = await new SearchService(
      'pk.fixture.public',
      fetcher,
    ).search(query);
    expect(results[0]!.name).toBe(term + ' - Provider street and locality');
    const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));
    const suggest = urls.find(u => u.pathname.endsWith('/suggest'))!;
    expect(suggest.searchParams.get('q')).toBe(term);
    expect(suggest.searchParams.get('country')).toBe('us,ca,mx');
    expect(
      urls.some(
        u =>
          u.searchParams.get('q') === city + ' ' + code &&
          u.searchParams.get('types') === 'place,locality',
      ),
    ).toBe(true);
  },
);

test('complete street address stays a single full-query forward lookup', async () => {
  const fetcher = transport();
  const results = await new SearchService('pk.fixture.public', fetcher).search(
    '2425 E 2nd St Reno NV',
  );
  expect(results).toEqual([
    { id: 'provider-id', name: 'Fixture address', lat: 40, lng: -100 },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.searchParams.get('q')).toBe('2425 E 2nd St Reno NV');
  expect(url.searchParams.has('proximity')).toBe(false);
});

test('ambiguous provider locality keeps original full-query results, never chooses the first city', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ features: [feature] }))
    .mockResolvedValueOnce(
      jsonResponse({
        features: [
          localityFeature,
          {
            ...localityFeature,
            properties: {
              ...localityFeature.properties,
              mapbox_id: 'another-city',
            },
          },
        ],
      }),
    );
  expect(
    await new SearchService('pk.fixture.public', fetcher).search(
      'Walmart Reno NV',
    ),
  ).toEqual([
    { id: 'provider-id', name: 'Fixture address', lng: -100, lat: 40 },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  'no context',
  'wrong region',
  'unsupported country',
  'invalid coordinates',
  'extra locality words',
  'wrong feature type',
])('unproven locality (%s) never supplies POI proximity', async kind => {
  const candidate = JSON.parse(JSON.stringify(localityFeature));
  if (kind === 'no context') delete candidate.properties.context;
  if (kind === 'wrong region')
    candidate.properties.context.region = {
      name: 'Elsewhere',
      region_code: 'ZZ',
    };
  if (kind === 'unsupported country')
    candidate.properties.context.country.country_code = 'FR';
  if (kind === 'invalid coordinates')
    candidate.geometry.coordinates = [999, 39];
  if (kind === 'extra locality words') candidate.properties.name = 'South Reno';
  if (kind === 'wrong feature type')
    candidate.properties.feature_type = 'address';
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ features: [feature] }))
    .mockResolvedValueOnce(jsonResponse({ features: [candidate] }));
  const results = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );
  expect(results[0]!.id).toBe('provider-id');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.every(
      ([u]) => !new URL(String(u)).searchParams.has('proximity'),
    ),
  ).toBe(true);
});

test('bounded speculative splits never discard unmatched business words or fabricate a default locality', async () => {
  const fetcher = transport({ features: [] });
  expect(
    await new SearchService('pk.fixture.public', fetcher).search(
      'An Unknown Long Business Name In Unresolved Locality',
    ),
  ).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(5);
  for (const [input] of fetcher.mock.calls) {
    const u = new URL(String(input));
    expect(u.pathname).toContain('/forward');
    expect(u.searchParams.has('proximity')).toBe(false);
  }
});

test.each([
  'non-POI',
  'wrong identity',
  'malformed geometry',
  'multiple features',
])('retrieve refuses %s as business evidence', async kind => {
  const candidate = JSON.parse(JSON.stringify(businessFeature));
  if (kind === 'non-POI') candidate.properties.feature_type = 'place';
  if (kind === 'wrong identity') candidate.properties.mapbox_id = 'unrelated';
  if (kind === 'malformed geometry') candidate.geometry.coordinates = [0, 999];
  const fetcher = jest.fn(async (input: RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/suggest'))
      return jsonResponse({ suggestions: [businessFeature.properties] });
    if (url.pathname.includes('/retrieve/'))
      return jsonResponse({
        features:
          kind === 'multiple features' ? [candidate, candidate] : [candidate],
      });
    return jsonResponse({ features: [localityFeature] });
  });
  const results = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );
  expect(results).toEqual([
    { id: 'fixture-city', name: 'Reno', lng: -119.8138, lat: 39.5296 },
  ]);
  expect(
    results.every(
      r =>
        !('truckSafe' in r) &&
        !('truckVerified' in r) &&
        !('navigationAllowed' in r),
    ),
  ).toBe(true);
});

test('POI-only suggestions do not retrieve geographic suggestions', async () => {
  const fetcher = jest.fn(async (input: RequestInfo) =>
    new URL(String(input)).pathname.endsWith('/suggest')
      ? jsonResponse({ suggestions: [localityFeature.properties] })
      : jsonResponse({ features: [localityFeature] }),
  );
  await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );
  expect(
    fetcher.mock.calls.some(([u]) => String(u).includes('/retrieve/')),
  ).toBe(false);
});

test.each(['locality', 'suggest', 'retrieve'])(
  'cancellation during %s stops subsequent requests even when transport ignores abort',
  async stage => {
    const pending = deferred<Response>(),
      reached = deferred<void>();
    const controller = new AbortController();
    const fetcher = jest.fn(async (input: RequestInfo) => {
      const u = new URL(String(input));
      if (
        (stage === 'locality' &&
          u.searchParams.get('types') === 'place,locality') ||
        (stage === 'suggest' && u.pathname.endsWith('/suggest')) ||
        (stage === 'retrieve' && u.pathname.includes('/retrieve/'))
      ) {
        reached.resolve();
        return pending.promise;
      }
      if (u.pathname.endsWith('/suggest'))
        return jsonResponse({ suggestions: [businessFeature.properties] });
      return jsonResponse({ features: [localityFeature] });
    });
    const request = new SearchService('pk.fixture.public', fetcher).search(
      'Walmart Reno NV',
      undefined,
      controller.signal,
    );
    const outcome = request.catch(e => e);
    await reached.promise;
    const count = fetcher.mock.calls.length;
    controller.abort();
    pending.resolve(
      jsonResponse(
        stage === 'suggest'
          ? { suggestions: [businessFeature.properties] }
          : {
              features: [
                stage === 'retrieve' ? businessFeature : localityFeature,
              ],
            },
      ),
    );
    expect((await outcome).message).toBe('Search cancelled.');
    expect(fetcher).toHaveBeenCalledTimes(count);
  },
);

test('already-cancelled business search makes no requests', async () => {
  const fetcher = businessTransport(),
    controller = new AbortController();
  controller.abort();
  await expect(
    new SearchService('pk.fixture.public', fetcher).search(
      'Walmart Reno NV',
      undefined,
      controller.signal,
    ),
  ).rejects.toThrow('Search cancelled');
  expect(fetcher).not.toHaveBeenCalled();
});

test('closing/account switch while locality lookup runs discards late business results', async () => {
  const pending = deferred<Response>(),
    reached = deferred<void>();
  const fetcher = jest.fn(async (input: RequestInfo) => {
    const u = new URL(String(input));
    if (u.searchParams.has('types')) {
      reached.resolve();
      return pending.promise;
    }
    return jsonResponse({ features: [localityFeature] });
  });
  const store = new DestinationSearchStore(
    new SearchService('pk.fixture.public', fetcher),
    { nearby: jest.fn() } as unknown as PoiService,
  );
  store.schedule('Walmart Reno NV');
  const request = store.searchNow();
  await reached.promise;
  store.clear();
  store.clearRecent();
  pending.resolve(jsonResponse({ features: [localityFeature] }));
  await request;
  expect(store.getSnapshot()).toMatchObject({
    query: '',
    phase: 'idle',
    results: [],
    pois: [],
    recentQueries: [],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot().error).toBeUndefined();
});

test('malformed suggestions fall back without leaking provider credentials', async () => {
  const fetcher = jest.fn(async (input: RequestInfo) => {
    if (String(input).includes('/suggest'))
      throw new Error(
        'access_token=PRIVATE_PROVIDER_VALUE session_token=PRIVATE_SESSION',
      );
    return jsonResponse({ features: [localityFeature] });
  });
  const results = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );
  expect(JSON.stringify(results)).not.toContain('PRIVATE');
  expect(results[0]!.name).toBe('Reno');
});

test('punctuation-only business prefix cannot produce an empty POI query', async () => {
  const fetcher = transport({ features: [localityFeature] });
  const result = await new SearchService('pk.fixture.public', fetcher).search(
    ', Reno NV',
  );
  expect(result[0]!.id).toBe('fixture-city');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('provider aliases support punctuation and full region/country names without local tables', async () => {
  const fetcher = businessTransport();
  await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart, Reno, Nevada United States',
  );
  const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));
  const suggest = urls.find(u => u.pathname.endsWith('/suggest'))!;
  expect(suggest.searchParams.get('q')).toBe('Walmart');
  expect(suggest.searchParams.get('proximity')).toBe('-119.8138,39.5296');
});

test('business locality overrides fresh current-location proximity when explicit locality is present', async () => {
  const qualifiedLocality = {
    ...localityFeature,
    properties: {
      ...localityFeature.properties,
      context: {
        region: {
          name: 'Nevada',
          region_code: 'US-NV',
        },
        country: {
          name: 'United States',
          country_code: 'US',
        },
      },
    },
  };

  const fetcher = jest
    .fn()
    // Initial POI lookup around the supplied fresh current-location center.
    .mockResolvedValueOnce(jsonResponse({ suggestions: [] }))
    // Full-query forward fallback.
    .mockResolvedValueOnce(jsonResponse({ features: [feature] }))
    // Provider locality resolution for Reno NV.
    .mockResolvedValueOnce(jsonResponse({ features: [qualifiedLocality] }))
    // Walmart POI lookup around the provider-returned Reno center.
    .mockResolvedValueOnce(
      jsonResponse({ suggestions: [businessFeature.properties] }),
    )
    .mockResolvedValueOnce(jsonResponse({ features: [businessFeature] }));

  const currentCenter = {
    lat: 40.7608,
    lng: -111.891,
  };

  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
    currentCenter,
  );

  expect(result).toEqual([
    {
      id: 'fixture-business',
      name: 'Walmart Supercenter - 2425 E 2nd St, Reno, NV',
      lng: -119.789,
      lat: 39.526,
    },
  ]);

  const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));

  expect(urls).toHaveLength(5);

  // First attempt still respects the supplied fresh center.
  expect(urls[0]!.pathname).toContain('/suggest');
  expect(urls[0]!.searchParams.get('q')).toBe('Walmart Reno NV');
  expect(urls[0]!.searchParams.get('proximity')).toBe(
    currentCenter.lng + ',' + currentCenter.lat,
  );

  // Full-query forward fallback may retain current proximity.
  expect(urls[1]!.pathname).toContain('/forward');
  expect(urls[1]!.searchParams.get('q')).toBe('Walmart Reno NV');

  // Explicit locality is then resolved by the provider.
  expect(urls[2]!.searchParams.get('q')).toBe('Reno NV');

  // The business search must use Reno's provider coordinates, not currentCenter.
  expect(urls[3]!.pathname).toContain('/suggest');
  expect(urls[3]!.searchParams.get('q')).toBe('Walmart');
  expect(urls[3]!.searchParams.get('proximity')).toBe('-119.8138,39.5296');

  // Suggest/retrieve must stay in the same Mapbox Search Box session.
  expect(urls[3]!.searchParams.get('session_token')).toBeTruthy();
  expect(urls[4]!.searchParams.get('session_token')).toBe(
    urls[3]!.searchParams.get('session_token'),
  );
});
test('business locality accepts provider-qualified region_code such as US-NV', async () => {
  const qualifiedLocality = {
    ...localityFeature,
    properties: {
      ...localityFeature.properties,
      context: {
        region: {
          name: 'Nevada',
          region_code: 'US-NV',
        },
        country: {
          name: 'United States',
          country_code: 'US',
        },
      },
    },
  };

  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ features: [feature] }))
    .mockResolvedValueOnce(jsonResponse({ features: [qualifiedLocality] }))
    .mockResolvedValueOnce(
      jsonResponse({ suggestions: [businessFeature.properties] }),
    )
    .mockResolvedValueOnce(jsonResponse({ features: [businessFeature] }));

  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Reno NV',
  );

  expect(result).toEqual([
    {
      id: 'fixture-business',
      name: 'Walmart Supercenter - 2425 E 2nd St, Reno, NV',
      lng: -119.789,
      lat: 39.526,
    },
  ]);

  const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));

  expect(urls).toHaveLength(4);
  expect(urls[1]!.searchParams.get('q')).toBe('Reno NV');
  expect(urls[2]!.searchParams.get('q')).toBe('Walmart');
  expect(urls[2]!.searchParams.get('proximity')).toBe('-119.8138,39.5296');
  expect(urls[2]!.searchParams.get('session_token')).toBeTruthy();
  expect(urls[3]!.searchParams.get('session_token')).toBe(
    urls[2]!.searchParams.get('session_token'),
  );
});

test.each(['Walmart Monterrey NL', 'Walmart Monterrey Nuevo Leon'])(
  'F024 resolves %s to provider-backed Monterrey Walmart POIs',
  async query => {
    const monterreyLocality = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-100.31382, 25.680523],
      },
      properties: {
        mapbox_id: 'fixture-monterrey',
        feature_type: 'place',
        name: 'Monterrey',
        context: {
          region: {
            name: 'Nuevo León',
            region_code: 'NLE',
            region_code_full: 'MX-NLE',
          },
          country: {
            name: 'Mexico',
            country_code: 'MX',
            country_code_alpha_3: 'MEX',
          },
        },
      },
    };

    const walmartSuggestion = {
      mapbox_id: 'fixture-walmart-monterrey',
      feature_type: 'poi',
      name: 'Walmart Supercenter',
      full_address: 'Av Lázaro Cárdenas 900, 64750 Monterrey, Mexico',
      place_formatted: '64750 Monterrey, Mexico',
    };

    const walmartFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-100.3001, 25.6501],
      },
      properties: walmartSuggestion,
    };

    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          features: [feature],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          features: [monterreyLocality],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          suggestions: [walmartSuggestion],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          features: [walmartFeature],
        }),
      );

    const result = await new SearchService('pk.fixture.public', fetcher).search(
      query,
    );

    expect(result).toEqual([
      {
        id: 'fixture-walmart-monterrey',
        name: 'Walmart Supercenter - Av Lázaro Cárdenas 900, 64750 Monterrey, Mexico',
        lng: -100.3001,
        lat: 25.6501,
      },
    ]);

    const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));

    expect(urls).toHaveLength(4);

    expect(urls[1]!.searchParams.get('q')).toBe(
      query.replace(/^Walmart\s+/, ''),
    );

    expect(urls[1]!.searchParams.get('types')).toBe('place,locality');

    expect(urls[2]!.pathname).toContain('/suggest');
    expect(urls[2]!.searchParams.get('q')).toBe('Walmart');

    expect(urls[2]!.searchParams.get('proximity')).toBe('-100.31382,25.680523');

    expect(urls[2]!.searchParams.get('country')).toBe('us,ca,mx');

    expect(urls[3]!.searchParams.get('session_token')).toBe(
      urls[2]!.searchParams.get('session_token'),
    );
  },
);
test('F024 explicit Monterrey locality overrides unrelated full-query POIs', async () => {
  const unrelatedPoi = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-99.1332, 19.4326],
    },
    properties: {
      mapbox_id: 'fixture-unrelated-poi',
      feature_type: 'poi',
      name: 'Monterrey nuevo leon',
      full_address: 'Zocalo 1, 06090 Mexico City, Mexico',
      place_formatted: '06090 Mexico City, Mexico',
    },
  };

  const monterreyLocality = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-100.31382, 25.680523],
    },
    properties: {
      mapbox_id: 'fixture-monterrey',
      feature_type: 'place',
      name: 'Monterrey',
      context: {
        region: {
          name: 'Nuevo León',
          region_code: 'NLE',
          region_code_full: 'MX-NLE',
        },
        country: {
          name: 'Mexico',
          country_code: 'MX',
          country_code_alpha_3: 'MEX',
        },
      },
    },
  };

  const walmartSuggestion = {
    mapbox_id: 'fixture-walmart-monterrey',
    feature_type: 'poi',
    name: 'Walmart Supercenter',
    full_address: 'Av Lázaro Cárdenas 900, 64750 Monterrey, Mexico',
    place_formatted: '64750 Monterrey, Mexico',
  };

  const walmartFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-100.3001, 25.6501],
    },
    properties: walmartSuggestion,
  };

  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        features: [unrelatedPoi],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        features: [monterreyLocality],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        suggestions: [walmartSuggestion],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        features: [walmartFeature],
      }),
    );

  const result = await new SearchService('pk.fixture.public', fetcher).search(
    'Walmart Monterrey Nuevo Leon',
  );

  expect(result).toEqual([
    {
      id: 'fixture-walmart-monterrey',
      name: 'Walmart Supercenter - Av Lázaro Cárdenas 900, 64750 Monterrey, Mexico',
      lng: -100.3001,
      lat: 25.6501,
    },
  ]);

  const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));

  expect(urls).toHaveLength(4);
  expect(urls[1]!.searchParams.get('q')).toBe('Monterrey Nuevo Leon');
  expect(urls[2]!.searchParams.get('q')).toBe('Walmart');
  expect(urls[2]!.searchParams.get('proximity')).toBe('-100.31382,25.680523');
});
test('F025 rapid repeated manual submissions share one in-flight search', async () => {
  const { store, search } = setup();
  const pending = deferred<Stop[]>();

  search.search.mockReturnValueOnce(pending.promise);
  store.schedule('Walmart Reno NV');

  const requests = Array.from({ length: 8 }, () => store.searchNow());

  expect(search.search).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(8);
  expect(store.getSnapshot().phase).toBe('loading');

  pending.resolve([place]);
  await Promise.all(requests);

  expect(search.search).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot()).toMatchObject({
    phase: 'ready',
    results: [place],
  });
  expect(store.getSnapshot().error).toBeUndefined();

  store.cancel();
});
