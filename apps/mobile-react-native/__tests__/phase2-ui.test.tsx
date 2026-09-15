import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Text, TextInput } from 'react-native';
import { DriverError } from '../src/errors/driverErrors';
import { LocationService, type LocationProvider } from '../src/services/location/LocationService';
import Mapbox from '@rnmapbox/maps';
import { DriverShell } from '../src/navigation/AppNavigator';
import { PlanningScreen } from '../src/screens/PlanningScreen';
import { TruckMap } from '../src/features/map/TruckMap';
import type { Services } from '../src/app/services';
import { Store } from '../src/state/Store';
import { SettingsService } from '../src/features/settings/SettingsService';
import type { ApiClient } from '../src/services/api/ApiClient';
import { RouteStore } from '../src/features/routing/RouteStore';
import { truck, user, route, deferred } from './fixtures';
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  NavigationContainer: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
const mockSetCamera = jest.fn();
jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn().mockResolvedValue(undefined),
    MapView: 'NativeMapView',
    Camera: require('react').forwardRef((props: unknown, ref: unknown) => {
      require('react').useImperativeHandle(ref, () => ({
        setCamera: mockSetCamera,
        fitBounds: jest.fn(),
      }));
      return require('react').createElement('Camera', props);
    }),
    MarkerView: 'MarkerView',
    PointAnnotation: 'PointAnnotation',
    ShapeSource: 'ShapeSource',
    LineLayer: 'LineLayer',
    StyleURL: { Dark: 'dark', Street: 'street' },
  },
}));
let screen: ReactTestRenderer;
function setup(selected: typeof truck | null = truck, fix: unknown = null) {
  const calculate = jest.fn().mockResolvedValue(true);
  const routes = Object.assign(
    new Store({ phase: 'idle', route: null, plan: null }),
    { calculate },
  );
  const trucks = Object.assign(
    new Store({ profiles: selected ? [selected] : [], selected }),
    { load: jest.fn().mockResolvedValue(undefined) },
  );
  const location = Object.assign(new Store({ fix, tracking: !!fix }), {
    getFreshFix: jest.fn(() => fix),
    requestFreshFix: jest.fn(async () => { if (!fix) throw new DriverError('GPS_ACQUISITION_TIMEOUT'); return fix; }),
    startIfPermitted: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  });
  const services = {
    environment: { mapboxToken: '' },
    auth: new Store({ status: 'signedIn', user }),
    routes,
    trucks,
    location,
    settings: new SettingsService({
      request: jest.fn().mockResolvedValue({
        voiceEnabled: true,
        voiceMuted: false,
        voiceLocale: 'en-US',
        units: 'imperial',
        dayNightMode: 'day',
        trafficReroute: false,
        settingsJson: null,
      }),
    } as unknown as ApiClient),
    search: {
      search: jest
        .fn()
        .mockResolvedValue([
          { id: 'dest', name: 'Real provider destination', lat: 41, lng: -100 },
        ]),
    },
    poi: { nearby: jest.fn().mockResolvedValue([]) },
    guidance: { startNavigation: jest.fn() },
  } as unknown as Services;
  return { services, calculate };
}
const content = () =>
  screen.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
function button(label: string) {
  return screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
}
async function press(label: string) {
  await act(async () => {
    button(label).props.onPress();
  });
}
async function search() {
  await press('Set destination for truck routes');
  await act(async () =>
    screen.root.findByType(TextInput).props.onChangeText('warehouse'),
  );
  await press('Search');
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.clearAllMocks();
});
test('opens Map, offers all five tabs, and keeps planner state while switching tabs', async () => {
  const { services } = setup();
  await act(async () => {
    screen = create(<DriverShell services={services} open={jest.fn()} />);
  });
  expect(button('Map').props.accessibilityState.selected).toBe(true);
  for (const label of ['Home', 'Map', 'Trips', 'Docs', 'More'])
    expect(button(label)).toBeDefined();
  await press('Set destination for truck routes');
  await act(async () =>
    screen.root
      .findByType(TextInput)
      .props.onChangeText('retained destination'),
  );
  await press('Close Set destination');
  await press('Home');
  expect(content()).toContain('Ready to roll,');
  await press('Map');
  await press('Set destination for truck routes');
  expect(screen.root.findByType(TextInput).props.value).toBe(
    'retained destination',
  );
});
test('empty token shows honest map unavailable state without initializing or mounting Mapbox', async () => {
  await act(async () => {
    screen = create(
      <TruckMap
        token=""
        route={null}
        plan={null}
        fix={null}
        night={false}
        pois={[]}
      />,
    );
  });
  expect(content()).toContain('public Mapbox token');
  expect(Mapbox.setAccessToken).not.toHaveBeenCalled();
  expect(
    screen.root.findAll(n => String(n.type) === 'NativeMapView'),
  ).toHaveLength(0);
});
test('address browsing does not require GPS and does not calculate a route', async () => {
  const { services } = setup();
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  expect(services.search.search).toHaveBeenCalledWith(
    'warehouse',
    undefined,
    expect.any(AbortSignal),
  );
  expect(services.routes.calculate).not.toHaveBeenCalled();
});
test('missing truck profile blocks route calculation after selecting a real search result', async () => {
  const { services, calculate } = setup(null, {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 10,
  });
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  await act(async () => {
    screen.root
      .findAll(
        n =>
          typeof n.props.onPress === 'function' &&
          n.props.accessibilityRole === 'button',
      )
      .find(n =>
        n
          .findAllByType(Text)
          .some(t => t.props.children === 'Real provider destination'),
      )!
      .props.onPress();
  });
  await press('Set final destination');
  expect(calculate).not.toHaveBeenCalled();
  expect(content()).toContain('verified truck profile first');
});
test('request failures remain visible and never claim route readiness', async () => {
  const { services } = setup(truck, {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 10,
  });
  jest
    .mocked(services.search.search)
    .mockRejectedValueOnce(new Error('Map search unavailable'));
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  expect(content()).toContain('Places could not be loaded');
  expect(content()).not.toContain('Truck route ready');
});
test('real route preview labels estimates and keeps unverified guidance disabled', async () => {
  const { services } = setup();
  services.routes = new Store({
    phase: 'preview',
    route: route(),
    plan: {
      stops: [],
      destination: { id: 'dest', name: 'Destination', lat: 41, lng: -100 },
    },
  }) as unknown as RouteStore;
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Review route and stops');
  expect(content()).toContain('planning estimates');
  expect(content()).toContain('No alternatives were returned');
  expect(button('Compare alternatives')).toBeDefined();
  expect(button('Start navigation — unavailable').props.disabled).toBe(true);
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
});
test('busy search prevents duplicate provider calls and restores interaction after completion', async () => {
  const { services } = setup(truck, {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 10,
  });
  const pending = deferred<[]>();
  jest.mocked(services.search.search).mockReturnValueOnce(pending.promise);
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  await press('Search');
  expect(services.search.search).toHaveBeenCalledTimes(1);
  expect(button('Search').props.disabled).toBe(true);
  await act(async () => pending.resolve([]));
  expect(button('Search').props.disabled).toBe(false);
});

test('camera waits for native map load, then centers on an already available GPS fix', async () => {
  const fix = {
    latitude: 40,
    longitude: -100,
    timestamp: Date.now(),
    accuracy: 5,
    heading: 90,
    speed: 0,
  };
  await act(async () => {
    screen = create(
      <TruckMap
        token="test-public-token"
        route={null}
        plan={null}
        fix={fix}
        night={false}
        pois={[]}
        bottomInset={170}
      />,
    );
  });
  const map = screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!;
  expect(map.props.scaleBarEnabled).toBe(false);
  expect(map.props.logoPosition.bottom).toBeGreaterThan(170);
  expect(mockSetCamera).not.toHaveBeenCalled();
  await act(async () => map.props.onDidFinishLoadingMap());
  expect(mockSetCamera).toHaveBeenLastCalledWith(
    expect.objectContaining({
      centerCoordinate: [-100, 40],
      zoomLevel: 15,
      heading: 0,
    }),
  );
  await act(async () => map.props.onTouchStart());
  mockSetCamera.mockClear();
  await act(async () => {
    screen.update(
      <TruckMap
        token="test-public-token"
        route={null}
        plan={null}
        fix={{ ...fix, latitude: 40.01 }}
        night={false}
        pois={[]}
      />,
    );
  });
  expect(mockSetCamera).not.toHaveBeenCalled();
  await press('Recenter / follow truck');
  expect(mockSetCamera).toHaveBeenCalledWith(
    expect.objectContaining({ centerCoordinate: [-100, 40.01], zoomLevel: 15 }),
  );
});
test('no-fix map uses a regional overview without inventing a truck marker', async () => {
  await act(async () => {
    screen = create(
      <TruckMap
        token="test-public-token"
        route={null}
        plan={null}
        fix={null}
        night={false}
        pois={[]}
      />,
    );
  });
  const camera = screen.root.findAll(n => String(n.type) === 'Camera')[0]!;
  expect(camera.props.defaultSettings.zoomLevel).toBe(5);
  expect(
    screen.root.findAll(n => n.props.id === 'truck-position'),
  ).toHaveLength(0);
  expect(button('Recenter / follow truck').props.disabled).toBe(true);
});
test('places panel opens compact and expands while retaining all eight shortcuts', async () => {
  const { services } = setup();
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  expect(services.location.startIfPermitted).toHaveBeenCalledTimes(1);
  expect(button('Expand map places').props.accessibilityState.expanded).toBe(
    false,
  );
  await press('Expand map places');
  expect(button('Collapse map places').props.accessibilityState.expanded).toBe(
    true,
  );
  for (const label of [
    'Truck Stops',
    'Weigh Stations',
    'Parking',
    'Truck Fuel',
    'Rest Areas',
    'Walmarts',
    'Truck Washes',
    'More map features',
  ])
    expect(button(label)).toBeDefined();
  expect(content()).not.toContain('Add a verified truck profile');
});

test('retained Map applies saved night preference without remounting', async () => {
  const { services } = setup();
  services.environment = {
    ...services.environment,
    mapboxToken: 'test-public-token',
  };
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  expect(
    screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!.props
      .styleURL,
  ).toBe('street');
  const next = {
    ...services.settings.getSnapshot().settings!,
    dayNightMode: 'night' as const,
  };
  // Exercise the real observable service; the fake API returns the accepted server value.
  const request = (
    services.settings as unknown as { api: { request: jest.Mock } }
  ).api.request;
  request.mockResolvedValueOnce(next);
  await act(async () => {
    await services.settings.save(next);
  });
  expect(
    screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!.props
      .styleURL,
  ).toBe('dark');
});

test('map long-press forwards only valid coordinates for reverse-geocode confirmation', async () => {
  const select = jest.fn();
  await act(async () => {
    screen = create(
      <TruckMap
        token="test-public-token"
        route={null}
        plan={null}
        fix={null}
        night={false}
        pois={[]}
        onCoordinate={select}
      />,
    );
  });
  const map = screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!;
  await act(async () =>
    map.props.onLongPress({
      geometry: { type: 'Point', coordinates: [-100, 40] },
    }),
  );
  expect(select).toHaveBeenCalledWith({ lng: -100, lat: 40 });
  await act(async () =>
    map.props.onLongPress({
      geometry: { type: 'Point', coordinates: [999, 40] },
    }),
  );
  expect(select).toHaveBeenCalledTimes(1);
});
test('address browsing without GPS cannot produce a route after destination confirmation', async () => {
  const { services, calculate } = setup(truck, null);
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  await act(async () =>
    screen.root
      .findAll(
        n =>
          n.props.accessibilityRole === 'button' &&
          typeof n.props.onPress === 'function',
      )
      .find(n =>
        n
          .findAllByType(Text)
          .some(t => t.props.children === 'Real provider destination'),
      )!
      .props.onPress(),
  );
  await press('Set final destination');
  expect(calculate).not.toHaveBeenCalled();
  expect(content()).toContain('fresh precise GPS fix');
});


test('retained map dismisses its modal when the map loses focus', async () => {
 const { services } = setup();
 await act(async () => { screen = create(<PlanningScreen services={services} active />); });
 await press('Set destination for truck routes');
 await act(async () => screen.root.findByType(TextInput).props.onChangeText('retained destination'));
 await act(async () => screen.update(<PlanningScreen services={services} active={false} />));
 expect(button('Close Set destination')).toBeUndefined();
 await act(async () => screen.update(<PlanningScreen services={services} active />));
 expect(button('Close Set destination')).toBeUndefined();
 await press('Set destination for truck routes');
 expect(screen.root.findByType(TextInput).props.value).toBe('retained destination');
});

test('opening truck profiles from destination details closes the modal before navigation', async () => {
 const { services, calculate } = setup(null);
 const openTrucks = jest.fn();
 await act(async () => { screen = create(<PlanningScreen services={services} onTrucks={openTrucks} />); });
 await search();
 await act(async () => screen.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').find(n => n.findAllByType(Text).some(t => t.props.children === 'Real provider destination'))!.props.onPress());
 await press('Add truck profile to plan route');
 expect(openTrucks).toHaveBeenCalledTimes(1);
 expect(button('Close Set destination')).toBeUndefined();
 expect(calculate).not.toHaveBeenCalled();
});

function routingGps() {
  let emit: (raw: unknown) => void = () => {};
  const provider: LocationProvider = {
    permissionStatus: jest.fn(async () => 'denied'),
    permission: jest.fn(async () => 'granted'),
    start: jest.fn(async () => {}), stop: jest.fn(async () => {}),
    subscribe: (callback) => { emit = callback; return () => {}; },
  };
  return { service: new LocationService(provider), provider, emit: () => emit({ latitude: 40.25, longitude: -100.5, timestamp: Date.now(), accuracy: 4, heading: null, speed: 0 }) };
}
async function selectRouteDestination() {
  await search();
  await act(async () => {
    screen.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button')
      .find(n => n.findAllByType(Text).some(t => t.props.children === 'Real provider destination'))!.props.onPress();
  });
}
test('route selection requests GPS and sends the exact fresh origin only after acquisition', async () => {
  const { services, calculate } = setup(); const gps = routingGps(); services.location = gps.service;
  const previousAppState = AppState.currentState; AppState.currentState = 'active';
  try {
    await act(async () => { screen = create(<PlanningScreen services={services} />); });
    await selectRouteDestination(); await press('Set final destination');
    expect(content()).toContain('Acquiring a fresh precise GPS fix'); expect(calculate).not.toHaveBeenCalled(); expect(gps.provider.permission).toHaveBeenCalledWith(false);
    await act(async () => { gps.emit(); });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith({ lat: 40.25, lng: -100.5 }, expect.objectContaining({ destination: expect.objectContaining({ id: 'dest' }) }), truck, 0);
  } finally { await act(async () => { await gps.service.stop(); }); AppState.currentState = previousAppState; }
});
test('closing destination sheet while acquiring GPS never dispatches a late route', async () => {
  const { services, calculate } = setup(); const gps = routingGps(); services.location = gps.service;
  try {
    await act(async () => { screen = create(<PlanningScreen services={services} />); });
    await selectRouteDestination(); await press('Set final destination'); await press('Close Set destination');
    await act(async () => { gps.emit(); }); expect(calculate).not.toHaveBeenCalled();
  } finally { await act(async () => { await gps.service.stop(); }); }
});
test('changed truck during GPS acquisition is rejected before routing', async () => {
  const { services, calculate } = setup(); const gps = routingGps(); services.location = gps.service;
  const previousAppState = AppState.currentState; AppState.currentState = 'active';
  try {
    await act(async () => { screen = create(<PlanningScreen services={services} />); });
    await selectRouteDestination(); await press('Set final destination');
    const next = { ...services.trucks.getSnapshot(), selected: { ...truck } }; jest.spyOn(services.trucks, 'getSnapshot').mockReturnValue(next);
    await act(async () => { gps.emit(); }); expect(calculate).not.toHaveBeenCalled(); expect(content()).toContain('verified truck profile first');
  } finally { await act(async () => { await gps.service.stop(); }); AppState.currentState = previousAppState; }
});

test('alternative geometry renders as comparison only without replacing the primary route', async () => {
  const primary=route(); const geometry:[number,number][]=[[-100,40],[-100.01,40.001],[-100.02,40]];
  primary.alternatives=[{id:'alternate-fixture',routeGeometry:geometry,distanceMiles:13,durationSeconds:1260,etaMinutes:21,
    legs:[],turnByTurn:[],notices:[{code:'TRIMBLE_ALTERNATE_PREVIEW'}]}];
  await act(async()=>{screen=create(<TruckMap token="pk.fixture" route={primary} plan={null} fix={null} night={false} pois={[]}/>);});
  const sources=screen.root.findAllByType(Mapbox.ShapeSource);
  expect(sources.find(n=>n.props.id==='truck-route')?.props.shape.geometry.coordinates).toEqual(primary.routeGeometry);
  expect(sources.find(n=>n.props.id==='truck-alternative-0')?.props.shape).toMatchObject({properties:{previewOnly:true},geometry:{coordinates:geometry}});
  expect(primary.selectedRouteId).toBe('test-route'); expect(primary.turnByTurn).toHaveLength(2);
});
