import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  stationBrandId,
  stationBrandPictures,
} from '../src/features/poi/stationBrandPictures';
import {
  placeShortcuts,
  PoiArtwork,
  poiPictures,
} from '../src/features/poi/PoiPresentation';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import type { Poi } from '../src/features/poi/PoiService';
const station = (overrides: Partial<Poi> = {}): Poi => ({
  id: 'test-station',
  name: 'Independent',
  category: 'truck_stop',
  latitude: 40,
  longitude: -100,
  ...overrides,
});

test('separate Truck Fuel and CAT Scales shortcuts are removed; other categories stay available', () => {
  expect(placeShortcuts.map(x => x.category)).toEqual([
    'truck_stop',
    'weigh_station',
    'truck_parking',
    'rest_area',
    'walmart_store',
    'truck_wash',
    'truck_repair',
  ]);
  expect(poiPictures.fuel_stop).toEqual(poiPictures.truck_stop);
});

test.each([
  ['Pilot Travel Center #123', 'US', 'pilot'],
  ['Flying J Travel Center', 'US', 'flying-j'],
  ['Love’s Truck Stop', 'USA', 'loves'],
  ['TA Travel Center', 'US', 'ta'],
  ['Petro Stopping Centers', 'US', 'petro'],
  ["Buc-ee's", 'US', 'bucees'],
  ['Phillips 66', 'US', 'phillips-66'],
  ['Mobil Travel Center', 'US', 'mobil-travel-center'],
  ['Petro-Canada', 'CAN', 'petro-canada'],
  ['Petro-Pass', 'CA', 'petro-pass'],
  ['Esso', 'CA', 'esso'],
  ['Co-op', 'CA', 'co-op'],
  ['ONroute', 'CA', 'onroute'],
  ['OXXO Gas', 'MX', 'oxxo-gas'],
  ['PEMEX', 'MX', 'pemex'],
  ['G500', 'MEX', 'g500'],
  ['BP', 'México', 'bp-mexico'],
  ['Shell', 'MX', 'shell-mexico'],
  ['Chevron', 'MX', 'chevron-mexico'],
  ['Mobil', 'MX', 'mobil-mexico'],
  ['Petro Seven', 'MX', 'petro-seven'],
  ['ORSAN', 'MX', 'orsan'],
])('matches station identity %s (%s)', (name, country, expected) => {
  expect(stationBrandId(station({ name, country }))).toBe(expected);
});

test('explicit provider brand wins over name, unknown explicit brand stays generic', () => {
  expect(
    stationBrandId(
      station({ name: 'Local station', brand: 'Shell', countryCode: 'MX' }),
    ),
  ).toBe('shell-mexico');
  expect(
    stationBrandId(station({ name: 'Shell', brand: 'Independent' })),
  ).toBeUndefined();
  expect(
    stationBrandId(station({ name: 'Local station', brandName: 'Esso' })),
  ).toBe('esso');
});

test.each([
  'Pilot Mountain',
  'Shell Road Services',
  '76 Main Street',
  'Hospital near Shell',
  'Petroleum',
  'Independent',
])('does not guess a brand from %s', name => {
  expect(stationBrandId(station({ name }))).toBeUndefined();
});

test('brand images apply only to actual station categories, not similarly named POIs', () => {
  for (const category of [
    'walmart_store',
    'truck_repair',
    'truck_parking',
    'restaurant',
    'cat_scale',
  ])
    expect(
      stationBrandId(station({ name: 'Pilot', category })),
    ).toBeUndefined();
  expect(
    stationBrandId(station({ name: 'Pilot', category: 'fuel_stop' })),
  ).toBe('pilot');
  expect(
    stationBrandId(station({ name: 'Esso', category: 'gas_station' })),
  ).toBe('esso');
});

test.each(['day', 'night'] as const)(
  'renders the supplied station logo in %s and preserves generic fallback',
  async mode => {
    let screen!: ReactTestRenderer;
    await act(async () => {
      screen = create(
        <DriverAppearanceContext.Provider value={mode}>
          <PoiArtwork poi={station({ name: 'PEMEX' })} pin />
        </DriverAppearanceContext.Provider>,
      );
    });
    const image = screen.root.findAll(
      n => n.props.testID === 'station-logo-pemex',
    )[0];
    expect(image?.props.source).toEqual(stationBrandPictures.pemex);
    await act(async () => {
      screen.update(
        <DriverAppearanceContext.Provider value={mode}>
          <PoiArtwork poi={station({ category: 'fuel_stop' })} />
        </DriverAppearanceContext.Provider>,
      );
    });
    expect(
      screen.root.findAll(
        n =>
          typeof n.props.testID === 'string' &&
          n.props.testID.startsWith('station-logo-'),
      ),
    ).toHaveLength(0);
    expect(
      screen.root.findAll(n => n.props.testID === 'poi-picture-fuel_stop')
        .length,
    ).toBeGreaterThan(0);
    await act(async () => screen.unmount());
  },
);
