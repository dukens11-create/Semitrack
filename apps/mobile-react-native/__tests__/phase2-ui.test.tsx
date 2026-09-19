import { TruckProfileScreen } from '../src/screens/TruckProfileScreen';
import { EldScreen } from '../src/screens/EldScreen';
import { OfflineMapsScreen } from '../src/screens/OfflineMapsScreen';
import { ServicesScreen } from '../src/screens/ServicesScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import {
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  useColorScheme,
} from 'react-native';
import { Alert } from '../src/components/ThemedAlert';
import {
  DriverAppearanceContext,
  DriverPreferences,
} from '../src/features/settings/DriverPreferences';
import {
  UnavailableNavigationEngine,
  type NavigationState,
} from '../src/services/guidance/NavigationEngine';
import { Share } from 'react-native';
import { DriverCard } from '../src/components/DriverUI';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Text, TextInput } from 'react-native';
import { DriverError } from '../src/errors/driverErrors';
import {
  LocationService,
  type LocationProvider,
} from '../src/services/location/LocationService';
import Mapbox from '@rnmapbox/maps';
import { AppNavigator, DriverShell } from '../src/navigation/AppNavigator';
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
  DarkTheme: { dark: true, colors: {} },
  DefaultTheme: { dark: false, colors: {} },
  NavigationContainer: ({ children, ...props }: React.PropsWithChildren) =>
    require('react').createElement('NavigationHost', props, children),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children, ...props }: React.PropsWithChildren) =>
      require('react').createElement('StackHost', props, children),
    Screen: () => null,
  }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View: NativeView } = require('react-native');
  return { SafeAreaView: NativeView };
});
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));
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
    offlineManager: {
      getPacks: jest.fn().mockResolvedValue([]),
      unsubscribe: jest.fn(),
    },
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
    requestFreshFix: jest.fn(async () => {
      if (!fix) throw new DriverError('GPS_ACQUISITION_TIMEOUT');
      return fix;
    }),
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
    guidance: Object.assign(new UnavailableNavigationEngine(), {
      startNavigation: jest.fn(),
    }),
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
test('real route preview retains visible Start and fails closed on unavailable guidance', async () => {
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
  expect(button('Start Navigation').props.disabled).toBe(false);
  await press('Start Navigation');
  expect(content()).toContain('CoPilot provisioning required');
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
test('places panel retains seven categories and omits separate Truck Fuel and CAT Scales shortcuts', async () => {
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
    'Rest Areas',
    'Walmarts',
    'Truck Washes',
    'Truck Repair',
    'More map features',
  ])
    expect(button(label)).toBeDefined();
  expect(button('Truck Fuel')).toBeUndefined();
  expect(button('CAT Scales')).toBeUndefined();
  expect(content()).not.toContain('Add a verified truck profile');
});

test('retained Map applies saved night preference without remounting', async () => {
  const { services } = setup();
  services.environment = {
    ...services.environment,
    mapboxToken: 'test-public-token',
  };
  await act(async () => {
    screen = create(
      <DriverPreferences services={services}>
        <PlanningScreen services={services} />
      </DriverPreferences>,
    );
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
  await act(async () => {
    screen = create(<PlanningScreen services={services} active />);
  });
  await press('Set destination for truck routes');
  await act(async () =>
    screen.root
      .findByType(TextInput)
      .props.onChangeText('retained destination'),
  );
  await act(async () =>
    screen.update(<PlanningScreen services={services} active={false} />),
  );
  expect(button('Close Set destination')).toBeUndefined();
  await act(async () =>
    screen.update(<PlanningScreen services={services} active />),
  );
  expect(button('Close Set destination')).toBeUndefined();
  await press('Set destination for truck routes');
  expect(screen.root.findByType(TextInput).props.value).toBe(
    'retained destination',
  );
});

test('opening truck profiles from destination details closes the modal before navigation', async () => {
  const { services, calculate } = setup(null);
  const openTrucks = jest.fn();
  await act(async () => {
    screen = create(
      <PlanningScreen services={services} onTrucks={openTrucks} />,
    );
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
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    subscribe: callback => {
      emit = callback;
      return () => {};
    },
  };
  return {
    service: new LocationService(provider),
    provider,
    emit: () =>
      emit({
        latitude: 40.25,
        longitude: -100.5,
        timestamp: Date.now(),
        accuracy: 4,
        heading: null,
        speed: 0,
      }),
  };
}
async function selectRouteDestination() {
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
}
test('route selection requests GPS and sends the exact fresh origin only after acquisition', async () => {
  const { services, calculate } = setup();
  const gps = routingGps();
  services.location = gps.service;
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await selectRouteDestination();
    await press('Set final destination');
    expect(content()).toContain('Acquiring a fresh precise GPS fix');
    expect(calculate).not.toHaveBeenCalled();
    expect(gps.provider.permission).toHaveBeenCalledWith(false);
    await act(async () => {
      gps.emit();
    });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(
      { lat: 40.25, lng: -100.5 },
      expect.objectContaining({
        destination: expect.objectContaining({ id: 'dest' }),
      }),
      truck,
      0,
    );
  } finally {
    await act(async () => {
      await gps.service.stop();
    });
    AppState.currentState = previousAppState;
  }
});
test('closing destination sheet while acquiring GPS never dispatches a late route', async () => {
  const { services, calculate } = setup();
  const gps = routingGps();
  services.location = gps.service;
  try {
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await selectRouteDestination();
    await press('Set final destination');
    await press('Close Set destination');
    await act(async () => {
      gps.emit();
    });
    expect(calculate).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      await gps.service.stop();
    });
  }
});
test('changed truck during GPS acquisition is rejected before routing', async () => {
  const { services, calculate } = setup();
  const gps = routingGps();
  services.location = gps.service;
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await selectRouteDestination();
    await press('Set final destination');
    const next = { ...services.trucks.getSnapshot(), selected: { ...truck } };
    jest.spyOn(services.trucks, 'getSnapshot').mockReturnValue(next);
    await act(async () => {
      gps.emit();
    });
    expect(calculate).not.toHaveBeenCalled();
    expect(content()).toContain('verified truck profile first');
  } finally {
    await act(async () => {
      await gps.service.stop();
    });
    AppState.currentState = previousAppState;
  }
});

test('alternative geometry renders as comparison only without replacing the primary route', async () => {
  const primary = route();
  const geometry: [number, number][] = [
    [-100, 40],
    [-100.01, 40.001],
    [-100.02, 40],
  ];
  primary.alternatives = [
    {
      id: 'alternate-fixture',
      routeGeometry: geometry,
      distanceMiles: 13,
      durationSeconds: 1260,
      etaMinutes: 21,
      legs: [],
      turnByTurn: [],
      notices: [{ code: 'TRIMBLE_ALTERNATE_PREVIEW' }],
    },
  ];
  await act(async () => {
    screen = create(
      <TruckMap
        token="pk.fixture"
        route={primary}
        plan={null}
        fix={null}
        night={false}
        pois={[]}
      />,
    );
  });
  const sources = screen.root.findAllByType(Mapbox.ShapeSource);
  expect(
    sources.find(n => n.props.id === 'truck-route')?.props.shape.geometry
      .coordinates,
  ).toEqual(primary.routeGeometry);
  expect(
    sources.find(n => n.props.id === 'truck-alternative-0')?.props.shape,
  ).toMatchObject({
    properties: { previewOnly: true },
    geometry: { coordinates: geometry },
  });
  expect(primary.selectedRouteId).toBe('test-route');
  expect(primary.turnByTurn).toHaveLength(2);
});

test('Phase2 assistant POI remains only a candidate until driver confirms canonical StopPlan routing', async () => {
  const previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const fix = {
      latitude: 40,
      longitude: -120,
      accuracy: 4,
      timestamp: Date.now(),
      speed: 0,
      heading: null,
    };
    const { services, calculate } = setup(truck, fix);
    (services.poi.nearby as jest.Mock).mockResolvedValue([
      {
        id: 'cat-fixture',
        name: 'CAT Scale fixture',
        category: 'cat_scale',
        latitude: 40.1,
        longitude: -120,
        provider: 'HERE',
      },
    ]);
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await press('Set destination for truck routes');
    await act(async () =>
      screen.root.findByType(TextInput).props.onChangeText('Find a CAT Scale'),
    );
    await press('Ask driver assistant');
    expect(content()).toContain('CAT Scale fixture');
    expect(calculate).not.toHaveBeenCalled();
    const candidate = screen.root
      .findAllByType(DriverCard)
      .find(card =>
        card
          .findAllByType(Text)
          .some(text => text.props.children === 'CAT Scale fixture'),
      )!;
    await act(async () => candidate.props.onPress!());
    expect(calculate).not.toHaveBeenCalled();
    await press('Set final destination');
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate.mock.calls[0][1]).toEqual({
      destination: {
        id: 'cat-fixture',
        name: 'CAT Scale fixture',
        lat: 40.1,
        lng: -120,
      },
      stops: [],
    });
    expect(services.guidance.startNavigation).not.toHaveBeenCalled();
  } finally {
    AppState.currentState = previousAppState;
  }
});

test('Navigation V2 starts only through actual engine, pauses, resumes and retains route after confirmed end', async () => {
  const { services } = setup();
  const accepted = route();
  services.routes = new Store({
    phase: 'preview',
    route: accepted,
    plan: {
      stops: [],
      destination: { id: 'd', name: 'Destination', lat: 40, lng: -100 },
    },
  }) as unknown as RouteStore;
  let state: NavigationState = { phase: 'idle' };
  const engine = {
    initialize: jest.fn(async () => ({ available: true })),
    setTruckProfile: jest.fn(async () => {}),
    setRoute: jest.fn(async () => {}),
    startNavigation: jest.fn(async () => {
      state = { phase: 'navigating', routeId: accepted.selectedRouteId };
    }),
    pauseNavigation: jest.fn(async () => {
      state = { ...state, phase: 'paused' };
    }),
    resumeNavigation: jest.fn(async () => {
      state = { ...state, phase: 'navigating' };
    }),
    stopNavigation: jest.fn(async () => {
      state = { phase: 'idle' };
    }),
    getNavigationState: () => state,
    subscribe: () => () => {},
  };
  services.guidance = engine as unknown as Services['guidance'];
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Start Navigation');
  expect(engine.setRoute).toHaveBeenCalledWith(
    accepted,
    services.routes.getSnapshot().plan,
  );
  expect(content()).toContain('Turn-by-turn navigation active');
  await press('Pause Navigation');
  expect(content()).toContain('Navigation paused');
  await press('Resume Navigation');
  expect(engine.resumeNavigation).toHaveBeenCalledTimes(1);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('End Navigation');
  expect(engine.stopNavigation).not.toHaveBeenCalled();
  await act(async () => {
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'End navigation')!
      .onPress!();
  });
  expect(engine.stopNavigation).toHaveBeenCalledTimes(1);
  expect(services.routes.getSnapshot().route).toBe(accepted);
  expect(button('Start Navigation')).toBeDefined();
  alert.mockRestore();
});

test('a route invalidated during capability initialization cannot start navigation', async () => {
  const { services } = setup();
  const accepted = route();
  services.routes = new Store({
    phase: 'preview',
    route: accepted,
    plan: {
      stops: [],
      destination: { id: 'd', name: 'Destination', lat: 40, lng: -100 },
    },
  }) as unknown as RouteStore;
  const wait = deferred<{ available: boolean; code: string }>();
  services.guidance.initialize = () => wait.promise;
  const start = services.guidance.startNavigation;
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Start Navigation');
  jest
    .spyOn(services.routes, 'getSnapshot')
    .mockReturnValue({ phase: 'idle', route: null, plan: null });
  await act(async () => wait.resolve({ available: true, code: 'TEST_ONLY' }));
  expect(start).not.toHaveBeenCalled();
});

function cancellableRoute(services: Services) {
  const initial = {
    phase: 'preview' as const,
    route: route(),
    plan: {
      stops: [],
      destination: { id: 'd', name: 'Destination', lat: 40, lng: -100 },
    },
  };
  class Routes extends Store<
    import('../src/features/routing/RouteStore').RouteState
  > {
    clear = jest.fn(() =>
      this.publish({ phase: 'idle', route: null, plan: null }),
    );
  }
  services.routes = new Routes(initial) as unknown as RouteStore;
}
async function confirmCancellation() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const before = screen.root.findAll(
    n => n.props.testID === 'navigation-hud',
  ).length;
  await press('Cancel Route');
  expect(
    screen.root.findAll(n => n.props.testID === 'navigation-hud'),
  ).toHaveLength(before);
  expect(alert).toHaveBeenLastCalledWith(
    'Cancel route?',
    'Your current route will be cleared.',
    expect.any(Array),
  );
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Cancel route')!
      .onPress!(),
  );
  alert.mockRestore();
}
test.each(['preview', 'unavailable', 'failure'] as const)(
  'cancel from %s clears route but preserves truck, login and GPS',
  async mode => {
    const fix = {
      latitude: 40,
      longitude: -100,
      accuracy: 5,
      timestamp: Date.now(),
      heading: 0,
      speed: 0,
    };
    const { services } = setup(truck, fix);
    cancellableRoute(services);
    const stop = jest.spyOn(services.guidance, 'stopNavigation');
    if (mode === 'failure') {
      services.guidance.initialize = async () => ({
        available: true,
        code: 'TEST_ONLY',
      });
      services.guidance.setTruckProfile = async () => {};
      services.guidance.setRoute = async () => {};
      services.guidance.startNavigation = jest
        .fn()
        .mockRejectedValue(new Error('start failed'));
    }
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    if (mode !== 'preview') await press('Start Navigation');
    await confirmCancellation();
    expect(services.routes.getSnapshot()).toEqual({
      phase: 'idle',
      route: null,
      plan: null,
    });
    expect(services.trucks.getSnapshot().selected).toBe(truck);
    expect(services.auth.getSnapshot().status).toBe('signedIn');
    expect(services.location.getSnapshot().fix).toBe(fix);
    expect(stop).not.toHaveBeenCalled();
    expect(button('Set destination for truck routes')).toBeDefined();
    expect(
      screen.root.findAll(n => n.props.testID === 'navigation-hud'),
    ).toHaveLength(0);
  },
);
test('Cancel remains enabled during hanging initialization and ignores late completion', async () => {
  const { services } = setup();
  cancellableRoute(services);
  const wait = deferred<{ available: boolean; code: string }>();
  services.guidance.initialize = () => wait.promise;
  const stop = jest.spyOn(services.guidance, 'stopNavigation');
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Start Navigation');
  expect(button('Cancel Route').props.disabled).not.toBe(true);
  await confirmCancellation();
  expect(button('Set destination for truck routes')).toBeDefined();
  await act(async () => wait.resolve({ available: true, code: 'TEST_ONLY' }));
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});
test.each(['navigating', 'paused', 'rerouting'] as const)(
  'cancel from %s clears state even when native stop throws',
  async phase => {
    const { services } = setup();
    cancellableRoute(services);
    services.guidance.getNavigationState = () => ({
      phase,
      routeId: 'test-route',
      remainingMeters: 20,
    });
    const stop = jest
      .spyOn(services.guidance, 'stopNavigation')
      .mockRejectedValue(new Error('native error'));
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await confirmCancellation();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(services.routes.getSnapshot().route).toBeNull();
    expect(button('Set destination for truck routes')).toBeDefined();
    expect(content()).toContain('stop could not be confirmed');
    expect(button('Retry stopping guidance')).toBeDefined();
  },
);

test('preview cancellation removes route geometry, stop markers and advisories while keeping GPS marker', async () => {
  const fix = {
    latitude: 40,
    longitude: -100,
    accuracy: 5,
    timestamp: Date.now(),
    speed: 0,
    heading: 0,
  };
  const { services } = setup(truck, fix);
  cancellableRoute(services);
  services.environment = {
    ...services.environment,
    mapboxToken: 'pk.test-fixture',
  };
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  expect(
    screen.root.findAll(n => n.props.id === 'truck-route').length,
  ).toBeGreaterThan(0);
  expect(
    screen.root.findAllByType(Mapbox.PointAnnotation).length,
  ).toBeGreaterThan(0);
  await confirmCancellation();
  expect(screen.root.findAll(n => n.props.id === 'truck-route')).toHaveLength(
    0,
  );
  expect(screen.root.findAllByType(Mapbox.PointAnnotation)).toHaveLength(0);
  expect(
    screen.root.findAll(n => n.props.id === 'truck-position').length,
  ).toBeGreaterThan(0);
});
test('cancel does not wait for native stop, and late guidance events cannot restore navigation', async () => {
  const { services } = setup();
  cancellableRoute(services);
  const wait = deferred<void>();
  let emit: (
    event: import('../src/services/guidance/NavigationEngine').NavigationEvent,
  ) => void = () => {};
  services.guidance.getNavigationState = () => ({
    phase: 'rerouting',
    routeId: 'test-route',
  });
  services.guidance.stopNavigation = jest.fn(() => wait.promise);
  services.guidance.subscribe = listener => {
    emit = listener;
    return () => {};
  };
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await confirmCancellation();
  expect(button('Set destination for truck routes')).toBeDefined();
  await act(async () =>
    emit({ type: 'onRerouteCompleted', routeId: 'test-route' }),
  );
  expect(button('Navigation Controls')).toBeUndefined();
  expect(services.routes.getSnapshot().route).toBeNull();
  await act(async () => wait.resolve());
});
test('navigation menu connects real map commands, settings, report UI and confirmed OS sharing', async () => {
  const { services } = setup();
  cancellableRoute(services);
  const settings = jest.fn(),
    report = jest.fn();
  await act(async () => {
    screen = create(
      <PlanningScreen
        services={services}
        onSettings={settings}
        onServices={report}
      />,
    );
  });
  await press('Navigation Controls');
  await press('Route Overview');
  expect(screen.root.findByType(TruckMap).props.command.type).toBe('overview');
  await press('Navigation Controls');
  await press('Recenter');
  expect(screen.root.findByType(TruckMap).props.command.type).toBe('recenter');
  await press('Navigation Controls');
  await press('Audio Settings');
  expect(settings).toHaveBeenCalledTimes(1);
  await press('Navigation Controls');
  await press('Report');
  expect(report).toHaveBeenCalledTimes(1);
  await press('Navigation Controls');
  await press('Places Filter');
  expect(button('Close Places Filter')).toBeDefined();
  await press('Close Places Filter');
  await press('Navigation Controls');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}),
    share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' });
  await press('Share Trip');
  expect(share).not.toHaveBeenCalled();
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Share summary')!
      .onPress!(),
  );
  expect(share).toHaveBeenCalledWith({
    message: expect.stringContaining('Not live tracking'),
  });
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
  alert.mockRestore();
  share.mockRestore();
});

test('truck bearing follows actual camera heading during free pan, not navigation phase alone', async () => {
  const fix = {
    latitude: 40,
    longitude: -100,
    accuracy: 5,
    timestamp: Date.now(),
    speed: 10,
    heading: 90,
  };
  await act(async () => {
    screen = create(
      <TruckMap
        token="pk.fixture"
        route={route()}
        plan={null}
        fix={fix}
        night={false}
        pois={[]}
        navigationActive
      />,
    );
  });
  const map = screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!;
  await act(async () => {
    map.props.onTouchStart();
    map.props.onCameraChanged({ properties: { heading: 30 } });
  });
  const icon = screen.root.findAll(
    n => n.props.accessibilityLabel === 'Truck GPS position',
  )[0]!;
  expect(icon.props.style.at(-1).transform[0].rotate).toBe('60deg');
});

test('reference map zoom, satellite and audio controls perform real camera or UI actions', async () => {
  const toggle = jest.fn(),
    audio = jest.fn();
  await act(async () => {
    screen = create(
      <TruckMap
        token="pk.fixture"
        route={route()}
        plan={null}
        fix={null}
        night={false}
        pois={[]}
        onToggleSatellite={toggle}
        onAudio={audio}
      />,
    );
  });
  const map = screen.root.findAll(n => String(n.type) === 'NativeMapView')[0]!;
  await act(async () =>
    map.props.onCameraChanged({ properties: { heading: 0, zoom: 18 } }),
  );
  await press('Zoom in');
  expect(mockSetCamera).toHaveBeenLastCalledWith({
    zoomLevel: 19,
    animationDuration: 200,
  });
  await press('Zoom out');
  expect(mockSetCamera).toHaveBeenLastCalledWith({
    zoomLevel: 18,
    animationDuration: 200,
  });
  await press('Toggle satellite map');
  expect(toggle).toHaveBeenCalledTimes(1);
  await press('Audio Settings');
  expect(audio).toHaveBeenCalledTimes(1);
  await press('Compass / north up');
  expect(mockSetCamera).toHaveBeenLastCalledWith({
    heading: 0,
    pitch: 0,
    animationDuration: 300,
  });
});
test('Places Filter changes map categories without launching a provider request', async () => {
  const { services } = setup();
  cancellableRoute(services);
  services.routes.calculate = jest.fn();
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Navigation Controls');
  await press('Places Filter');
  const category = () =>
    screen.root.findAll(
      n =>
        n.props.accessibilityRole === 'checkbox' &&
        n.props.accessibilityLabel === 'Truck Stops',
    )[0]!;
  expect(category().props.accessibilityState.checked).toBe(true);
  await act(async () => category().props.onPress());
  expect(category().props.accessibilityState.checked).toBe(false);
  await press('Show all categories');
  expect(category().props.accessibilityState.checked).toBe(true);
  expect(services.poi.nearby).not.toHaveBeenCalled();
  expect(services.routes.calculate).not.toHaveBeenCalled();
});
test('Reroute requires explicit confirmation in preview and cannot bypass active guidance gates', async () => {
  const { services } = setup();
  cancellableRoute(services);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Navigation Controls');
  await press('Reroute');
  expect(alert).toHaveBeenLastCalledWith(
    'Recalculate truck route?',
    expect.any(String),
    expect.any(Array),
  );
  expect(services.routes.getSnapshot().route).not.toBeNull();
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
  services.guidance.getNavigationState = () => ({
    phase: 'navigating',
    routeId: 'test-route',
  });
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await press('Navigation Controls');
  await press('Reroute');
  expect(alert).toHaveBeenLastCalledWith(
    'Live rerouting unavailable',
    expect.any(String),
  );
  expect(services.routes.getSnapshot().route).not.toBeNull();
  alert.mockRestore();
});

test('navigation keeps one persistent warning controller and exposes all safety controls', async () => {
  const { services } = setup();
  cancellableRoute(services);
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  const {
    RouteAdvisories,
  } = require('../src/features/navigation/RouteAdvisories');
  await press('Navigation Controls');
  expect(screen.root.findAllByType(RouteAdvisories)).toHaveLength(1);
  await press('Road Warnings');
  expect(button('Refresh road warnings')).toBeDefined();
  expect(button('Close road warnings')).toBeDefined();
  await press('Close road warnings');
  expect(button('Refresh road warnings')).toBeUndefined();
  await press('Navigation Controls');
  await press('POI Ahead');
  expect(button('Close POI Ahead')).toBeDefined();
  expect(services.guidance.startNavigation).not.toHaveBeenCalled();
});
test('full-map presentation is enabled only for a real session and restores tabs after cancellation', async () => {
  const { services } = setup();
  cancellableRoute(services);
  const presentation = jest.fn();
  await act(async () => {
    screen = create(
      <PlanningScreen
        services={services}
        onNavigationActiveChange={presentation}
      />,
    );
  });
  expect(presentation).toHaveBeenLastCalledWith(false);
  await act(async () => screen.unmount());
  services.guidance.getNavigationState = () => ({
    phase: 'navigating',
    routeId: 'test-route',
  });
  await act(async () => {
    screen = create(
      <PlanningScreen
        services={services}
        onNavigationActiveChange={presentation}
      />,
    );
  });
  expect(presentation).toHaveBeenLastCalledWith(true);
  await confirmCancellation();
  expect(presentation).toHaveBeenLastCalledWith(false);
});

test('map tools are bounded above the trip dock and below the measured header', async () => {
  await act(async () => {
    screen = create(
      <TruckMap
        token="pk.fixture"
        route={route()}
        plan={null}
        fix={null}
        night={true}
        pois={[]}
        topInset={118}
        bottomInset={190}
        onToggleSatellite={jest.fn()}
        onAudio={jest.fn()}
      />,
    );
  });
  const tools = screen.root.findAll(n => n.props.testID === 'map-tools')[0]!;
  expect(tools.props.style[1]).toEqual({ top: 134, bottom: 210 });
  for (const label of [
    'Compass / north up',
    'Recenter / follow truck',
    'Zoom in',
    'Zoom out',
    'Toggle satellite map',
    'Audio Settings',
    'Route overview',
  ])
    expect(button(label)).toBeDefined();
});

test('recent destination selection resolves fresh search results and routes with current GPS and saved truck without a route plan form', async () => {
  const priorState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const fresh = {
      latitude: 40,
      longitude: -100,
      timestamp: Date.now(),
      accuracy: 5,
      speed: 0,
      heading: 0,
    };
    const { services, calculate } = setup(truck, fresh);
    let saved = {
      voiceEnabled: true,
      voiceMuted: false,
      voiceLocale: 'en-US',
      units: 'imperial',
      dayNightMode: 'day',
      trafficReroute: false,
      settingsJson: {
        rnRecentDestinations: ['465 Test Road', 'Previous delivery'],
      },
    };
    services.settings = new SettingsService({
      request: async (method: string, _path: string, body: typeof saved) => {
        if (method === 'PUT') saved = body;
        return saved;
      },
    } as unknown as ApiClient);
    await act(async () => {
      screen = create(<PlanningScreen services={services} />);
    });
    await press('Set destination for truck routes');
    expect(content()).toContain('Recent');
    await press('465 Test Road');
    expect(services.search.search).toHaveBeenCalledWith(
      '465 Test Road',
      { lat: 40, lng: -100 },
      expect.any(AbortSignal),
    );
    expect(calculate).not.toHaveBeenCalled();
    await act(async () =>
      screen.root
        .findAllByType(DriverCard)
        .find(n => typeof n.props.onPress === 'function')!
        .props.onPress(),
    );
    await press('Set final destination');
    expect(calculate).toHaveBeenCalledWith(
      { lat: 40, lng: -100 },
      expect.objectContaining({
        destination: expect.objectContaining({ id: 'dest' }),
      }),
      truck,
      0,
    );
    expect(services.guidance.startNavigation).not.toHaveBeenCalled();
    expect(content()).not.toContain('Add Truck Route Plan');
    expect(saved.settingsJson.rnRecentDestinations).toContain('465 Test Road');
    expect(services.trucks.getSnapshot().selected).toBe(truck);
  } finally {
    AppState.currentState = priorState;
  }
});

test('invalidating an existing route stops active native guidance and leaves the saved truck intact', async () => {
  const { services } = setup();
  const accepted = route();
  class Routes extends Store<{
    phase: string;
    route: ReturnType<typeof route> | null;
    plan: null;
  }> {
    invalidate() {
      this.publish({ phase: 'idle', route: null, plan: null });
    }
  }
  const routes = new Routes({ phase: 'preview', route: accepted, plan: null });
  services.routes = routes as unknown as RouteStore;
  let state: NavigationState = {
    phase: 'navigating',
    routeId: accepted.selectedRouteId,
  };
  const stop = jest.fn(async () => {
    state = { phase: 'idle' };
  });
  services.guidance = {
    getNavigationState: () => state,
    subscribe: () => () => {},
    stopNavigation: stop,
  } as unknown as Services['guidance'];
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await act(async () => routes.invalidate());
  expect(stop).toHaveBeenCalledTimes(1);
  expect(services.trucks.getSnapshot().selected).toBe(truck);
});

test('search failure never disables unrelated POI categories and releases the search control', async () => {
  const { services } = setup(truck, {
    latitude: 40,
    longitude: -100,
    accuracy: 10,
    timestamp: Date.now(),
  });
  const pending = deferred<[]>();
  jest.mocked(services.search.search).mockReturnValueOnce(pending.promise);
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  await search();
  expect(button('Search').props.accessibilityState.busy).toBe(true);
  expect(button('Truck Stops').props.disabled).toBe(false);
  await act(async () => pending.reject(new Error('offline')));
  expect(button('Search').props.disabled).toBe(false);
  expect(button('Truck Stops').props.disabled).toBe(false);
  await press('Search');
  expect(button('Search').props.disabled).toBe(false);
});

test.each(['day', 'night'] as const)(
  'first native map style honors persisted %s without rendering the default style',
  async mode => {
    const { services } = setup();
    services.environment = { ...services.environment, mapboxToken: 'pk.test' };
    const pending = deferred<unknown>();
    services.settings = new SettingsService({
      request: () => pending.promise,
    } as unknown as ApiClient);
    await act(async () => {
      screen = create(
        <DriverPreferences services={services}>
          <PlanningScreen services={services} />
        </DriverPreferences>,
      );
    });
    expect(screen.root.findAllByType(Mapbox.MapView)).toHaveLength(0);
    await act(async () =>
      pending.resolve({
        voiceEnabled: true,
        voiceMuted: false,
        voiceLocale: 'en-US',
        units: 'imperial',
        dayNightMode: mode,
        trafficReroute: false,
        settingsJson: null,
      }),
    );
    expect(screen.root.findByType(Mapbox.MapView).props.styleURL).toBe(
      mode === 'day' ? 'street' : 'dark',
    );
  },
);

test('saved truck hydration never claims that the driver needs to add a truck', async () => {
  const { services } = setup();
  const pending = deferred<void>();
  jest.mocked(services.trucks.load).mockReturnValueOnce(pending.promise);
  await act(async () => {
    screen = create(<PlanningScreen services={services} />);
  });
  expect(content()).toContain('Loading saved truck');
  await act(async () => pending.resolve());
  expect(content()).toContain(truck.name);
  expect(content()).not.toContain('Loading saved truck');
});

test.each([
  ['day', 'dark', false],
  ['night', 'light', true],
  ['system', 'light', false],
  ['system', 'dark', true],
] as const)(
  '%s with system %s remains global through tabs, settings pages, all stack screens and back',
  async (mode, scheme, dark) => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    const { services } = setup();
    await services.settings.load();
    const saved = {
      ...services.settings.getSnapshot().settings!,
      dayNightMode: mode,
    };
    services.settings = new SettingsService({
      request: jest.fn(async () => saved),
    } as unknown as ApiClient);
    function Harness() {
      const [page, setPage] = React.useState('Main');
      return (
        <DriverPreferences services={services}>
          {page === 'Settings' ? (
            <SettingsScreen
              services={services}
              onBack={() => setPage('Main')}
            />
          ) : page !== 'Main' ? (
            <>
              <Pressable
                accessibilityLabel="Test stack back"
                onPress={() => setPage('Main')}
              >
                <Text>Back</Text>
              </Pressable>
              {page === 'Trucks' ? (
                <TruckProfileScreen services={services} />
              ) : page === 'Eld' ? (
                <EldScreen services={services} />
              ) : page === 'Offline' ? (
                <OfflineMapsScreen services={services} />
              ) : (
                <ServicesScreen services={services} />
              )}
            </>
          ) : (
            <DriverShell services={services} open={setPage} />
          )}
          {['Trucks', 'Services', 'Eld', 'Offline'].map(name => (
            <Pressable
              key={name}
              accessibilityLabel={'Test stack ' + name}
              onPress={() => setPage(name)}
            >
              <Text>{name}</Text>
            </Pressable>
          ))}
        </DriverPreferences>
      );
    }
    await act(async () => {
      screen = create(<Harness />);
    });
    const canvas = !dark ? '#F3F5F7' : '#0C131B';
    function check() {
      const surfaces = screen.root
        .findAllByType(ScrollView)
        .map(n => StyleSheet.flatten(n.props.style)?.backgroundColor)
        .filter(Boolean);
      expect(
        [
          ...screen.root.findAllByType(View),
          ...screen.root.findAllByType(ScrollView),
        ].some(
          n => StyleSheet.flatten(n.props.style)?.backgroundColor === canvas,
        ),
      ).toBe(true);
      expect(surfaces.every(color => color === canvas)).toBe(true);
    }
    for (const label of ['Home', 'Map', 'Trips', 'Docs', 'More']) {
      await press(label);
      check();
    }
    await press('Account and settings');
    check();
    for (const label of [
      'Account & profile',
      'Password & security',
      'Map & display',
      'Units',
      'Navigation',
      'Privacy & location',
      'About SemiTraX',
    ]) {
      await press(label);
      check();
      await press('Back');
    }
    await press('Back to More');
    await press('Map');
    check();
    for (const name of ['Trucks', 'Services', 'Eld', 'Offline']) {
      await press('Test stack ' + name);
      check();
      await press('Test stack back');
      check();
    }
  },
);

test.each(['day', 'night'] as const)(
  '%s navigation theme and every stack header/content use the shared palette',
  async mode => {
    const { services } = setup();
    await act(async () => {
      screen = create(
        <DriverAppearanceContext.Provider value={mode}>
          <AppNavigator services={services} />
        </DriverAppearanceContext.Provider>,
      );
    });
    const theme = screen.root.find(n => n.type === ('NavigationHost' as never))
      .props.theme;
    const options = screen.root.find(n => n.type === ('StackHost' as never))
      .props.screenOptions;
    expect(theme.dark).toBe(mode === 'night');
    expect(theme.colors.background).toBe(
      mode === 'day' ? '#F3F5F7' : '#0C131B',
    );
    expect(theme.colors.card).toBe(mode === 'day' ? '#FFFFFF' : '#17212C');
    expect(options.headerStyle.backgroundColor).toBe(theme.colors.card);
    expect(options.headerTintColor).toBe(theme.colors.text);
    expect(options.contentStyle.backgroundColor).toBe(theme.colors.background);
  },
);
