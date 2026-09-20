import { SearchService } from '../src/features/search/SearchService';
import { DestinationSearchStore } from '../src/features/search/DestinationSearchStore';
import type { PoiService } from '../src/features/poi/PoiService';

// Schema-faithful fixtures, not captured live responses or production POIs.
// Shape: https://docs.mapbox.com/api/search/search-box/#response-search-request
const json = (data: unknown) =>
  ({ ok: true, json: async () => data } as Response);
test.each([
  [
    'Walmart Reno NV',
    'Walmart',
    'Reno',
    'Nevada',
    'US-NV',
    'US',
    -119.8138,
    39.5296,
  ],
  [
    'Walmart Reno Nevada',
    'Walmart',
    'Reno',
    'Nevada',
    'NV',
    'US',
    -119.8138,
    39.5296,
  ],
  [
    'Walmart reno nV',
    'Walmart',
    'Reno',
    'Nevada',
    'US-NV',
    'US',
    -119.8138,
    39.5296,
  ],
  [
    'Costco Reno Nevada',
    'Costco',
    'Reno',
    'Nevada',
    'NV',
    'US',
    -119.8138,
    39.5296,
  ],
  [
    'Home Depot Toronto ON',
    'Home Depot',
    'Toronto',
    'Ontario',
    'CA-ON',
    'CA',
    -79.3832,
    43.6532,
  ],
  [
    'Walmart Toronto Ontario',
    'Walmart',
    'Toronto',
    'Ontario',
    'ON',
    'CA',
    -79.3832,
    43.6532,
  ],
  [
    'Costco Vancouver BC',
    'Costco',
    'Vancouver',
    'British Columbia',
    'CA-BC',
    'CA',
    -123.1207,
    49.2827,
  ],
  [
    'Walmart Las Vegas NV',
    'Walmart',
    'Las Vegas',
    'Nevada',
    'US-NV',
    'US',
    -115.1398,
    36.1699,
  ],
  [
    'Mercado Azul Monterrey Nuevo Leon',
    'Mercado Azul',
    'Monterrey',
    'Nuevo León',
    'MX-NLE',
    'MX',
    -100.31382,
    25.680523,
  ],
] as const)(
  '%s reaches business retrieve and cannot publish generic city/street results',
  async (query, business, city, region, code, country, lng, lat) => {
    const place = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        mapbox_id: 'fixture-locality',
        feature_type: 'place',
        name: city,
        place_formatted: region + ', ' + country,
        context: {
          country: {
            id: 'fixture-country',
            name: country,
            country_code: country,
          },
          region: {
            id: 'fixture-region',
            name: region,
            region_code: code,
            region_code_full: code.includes('-') ? code : country + '-' + code,
          },
        },
      },
    };
    const streets = [1, 2].map(n => ({
      ...place,
      properties: {
        ...place.properties,
        mapbox_id: 'fixture-street-' + n,
        feature_type: 'street',
        name: city + ' Avenue',
      },
    }));
    const poi = {
      ...place,
      properties: {
        ...place.properties,
        mapbox_id: 'fixture-business',
        feature_type: 'poi',
        name: business,
        address: '10 Test Fixture Road',
        full_address: '10 Test Fixture Road, ' + city + ', ' + region,
      },
    };
    const fetcher = jest.fn(async (url: string | URL | Request) => {
      const request = new URL(String(url));
      if (request.pathname.endsWith('/suggest'))
        return json({
          suggestions: [poi.properties],
          attribution: 'Fixture',
          response_id: 'fixture-suggest',
        });
      if (request.pathname.includes('/retrieve/'))
        return json({ type: 'FeatureCollection', features: [poi] });
      return json({
        type: 'FeatureCollection',
        features: request.searchParams.has('types')
          ? [place]
          : [place, ...streets],
        attribution: 'Fixture',
        response_id: 'fixture-forward',
      });
    });
    const service = new SearchService('pk.test-fixture', fetcher);
    const store = new DestinationSearchStore(service, {} as PoiService);
    store.schedule(query);
    await store.searchNow();
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      results: [
        {
          id: 'fixture-business',
          name: business + ' - ' + poi.properties.full_address,
          lat,
          lng,
        },
      ],
      pois: [],
    });
    expect(store.getSnapshot().results.map(p => p.id)).not.toContain(
      'fixture-locality',
    );
    expect(Object.keys(store.getSnapshot().results[0]!).sort()).toEqual([
      'id',
      'lat',
      'lng',
      'name',
    ]);
    const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    const suggest = urls.find(url => url.pathname.endsWith('/suggest'))!;
    expect(suggest.searchParams.get('q')).toBe(business);
    expect(suggest.searchParams.get('types')).toBe('poi');
    expect(suggest.searchParams.get('proximity')).toBe(lng + ',' + lat);
    expect(suggest.searchParams.get('country')).toBe('us,ca,mx');
    expect(
      urls
        .filter(url => url.pathname.endsWith('/forward'))
        .every(url => !url.searchParams.has('proximity')),
    ).toBe(true);
    const retrieve = urls.find(url => url.pathname.includes('/retrieve/'))!;
    expect(retrieve.searchParams.get('session_token')).toBe(
      suggest.searchParams.get('session_token'),
    );
    expect(store.getSnapshot().error).toBeUndefined();
    store.clear();
  },
);
