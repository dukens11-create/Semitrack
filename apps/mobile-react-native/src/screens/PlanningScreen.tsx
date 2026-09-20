import { MAX_INTERMEDIATE_STOPS } from '../models/routeLimits';
import {
  beginRouteDiagnostic,
  recordRouteFailure,
  routeDiagnosticHistory,
} from '../features/routing/routeTelemetry';
import { waitForRouteForeground } from '../features/routing/routeForeground';
import { Alert } from '../components/ThemedAlert';
import { WeatherStatus } from '../features/weather/WeatherStatus';
import {
  recentDestinations,
  addRecent,
  saveRecent,
} from '../features/search/recentDestinations';
import { RoutePoiBadges } from '../features/navigation/RoutePoiBadges';
import {
  NavigationPanel,
  NavigationAction,
} from '../features/navigation/NavigationPanel';
import {
  NavigationMenu,
  type NavigationMenuAction,
} from '../features/navigation/NavigationMenu';
import { shareRouteSummary } from '../features/navigation/shareRouteSummary';
import { GuidanceSession } from '../features/navigation/GuidanceSession';
import { applyGuidanceEvent } from '../features/navigation/guidanceEvents';
import { RouteAdvisories } from '../features/navigation/RouteAdvisories';
import { NavigationHud } from '../features/navigation/NavigationHud';
import { navigationPresentation } from '../features/navigation/navigationPresentation';
import { mapPreferences } from '../features/settings/mapPreferences';
import { RoutingCapabilityStatus } from '../components/RoutingCapabilityStatus';
import { CorridorRecords } from '../features/dot511/CorridorRecords';
import { DriverError } from '../errors/driverErrors';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DestinationSearchStore } from '../features/search/DestinationSearchStore';
import type { Services } from '../app/services';
import { ErrorText, errorMessage } from '../components/ui';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverEmpty,
  DriverTitle,
  useDriverPalette,
  ds,
} from '../components/DriverUI';
import { DriverSheet } from '../components/DriverSheet';
import { DriverIcon } from '../components/DriverIcon';
import { useStore } from '../hooks/useStore';
import {
  appendDestination,
  createStopPlan,
  removeRouteStop,
  reorderRouteStop,
  type Stop,
  type StopPlan,
} from '../features/stops/StopPlan';
import { RouteStops } from '../features/stops/RouteStops';
import { type PlaceCategory } from '../features/poi/PoiService';
import {
  PoiArtwork,
  PoiCategoryPicture,
  placeShortcuts,
  poiDetails,
} from '../features/poi/PoiPresentation';
import { TruckMap } from '../features/map/TruckMap';
import { RoutePreview } from '../features/routing/RoutePreview';
export function PlanningScreen({
  services,
  onTrucks,
  onServices,
  onSettings,
  active = true,
  onNavigationActiveChange,
}: {
  services: Services;
  onTrucks?: () => void;
  onServices?: () => void;
  onSettings?: () => void;
  active?: boolean;
  onNavigationActiveChange?: (active: boolean) => void;
}) {
  const routes = useStore(services.routes),
    trucks = useStore(services.trucks),
    location = useStore(services.location);
  const { settings } = useStore(services.settings);
  const [searchStore] = useState(
    () => new DestinationSearchStore(services.search, services.poi),
  );
  const searchState = useStore(searchStore);
  const { query, results, pois } = searchState;
  const [busy, setBusy] = useState(false);
  const [truckLoading, setTruckLoading] = useState(true);
  const [truckLoadFailed, setTruckLoadFailed] = useState(false);
  const [acquiringGps, setAcquiringGps] = useState(false);
  const gpsRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<
    | 'search'
    | 'route'
    | 'stops'
    | 'stop-detail'
    | 'location'
    | 'navigation'
    | 'places'
    | 'filter'
    | 'diagnostic'
    | null
  >(null);
  const [mapCommand, setMapCommand] = useState<{
    type: 'overview' | 'recenter';
    id: number;
  }>();
  const [weatherDetailsRequest, setWeatherDetailsRequest] = useState(0);
  const [satelliteOverride, setSatelliteOverride] = useState<boolean>();
  const [hiddenCategories, setHiddenCategories] = useState<PlaceCategory[]>([]);
  const [detail, setDetail] = useState<Stop | null>(null);
  const [appendPlan, setAppendPlan] = useState<StopPlan | null>(null);
  const searched = searchState.phase === 'ready';
  const [expanded, setExpanded] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(164);
  const [topHeight, setTopHeight] = useState(44);
  const busyRef = useRef(false);
  const operation = useRef(0);
  const [guidanceSession] = useState(
    () => new GuidanceSession(services.guidance),
  );
  const [startingNavigation, setStartingNavigation] = useState(false);
  const [stopUnconfirmed, setStopUnconfirmed] = useState(false);
  const [navigation, setNavigation] = useState(() =>
    services.guidance.getNavigationState(),
  );
  const navigationActive =
    navigation.phase === 'navigating' ||
    navigation.phase === 'paused' ||
    navigation.phase === 'rerouting';
  const navigationSession = navigationActive || navigation.phase === 'arrived';
  const palette = useDriverPalette();
  useEffect(() => {
    onNavigationActiveChange?.(active && navigationSession);
    return () => onNavigationActiveChange?.(false);
  }, [active, navigationSession, onNavigationActiveChange]);
  useEffect(() => {
    let mounted = true;
    void services.trucks
      .load()
      .catch(e => {
        if (mounted) {
          setTruckLoadFailed(true);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (mounted) setTruckLoading(false);
      });
    void services.settings.load().catch(e => {
      if (mounted) setError(errorMessage(e));
    });
    return () => {
      mounted = false;
    };
  }, [services]);
  useEffect(() => {
    setNavigation({ ...services.guidance.getNavigationState() });
    return services.guidance.subscribe(event => {
      if (
        !guidanceSession.acceptsEvents ||
        !services.routes.getSnapshot().route
      ) {
        setNavigation({ phase: 'idle' });
        return;
      }
      setNavigation(previous =>
        applyGuidanceEvent(
          previous,
          services.guidance.getNavigationState(),
          event,
          services.routes.getSnapshot().route,
        ),
      );
    });
  }, [services, guidanceSession]);
  useEffect(() => {
    let previous = services.routes.getSnapshot().route;
    let mounted = true;
    const unsubscribe = services.routes.subscribe(() => {
      const current = services.routes.getSnapshot().route;
      if (previous && current !== previous && guidanceSession.acceptsEvents) {
        setNavigation({ phase: 'idle' });
        void guidanceSession.cancel().then(confirmed => {
          if (!mounted) return;
          setStopUnconfirmed(!confirmed);
          if (!confirmed)
            setError(
              'The route changed, but guidance stop could not be confirmed. Retry stopping guidance before continuing.',
            );
        });
      }
      previous = current;
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [services, guidanceSession]);
  useEffect(() => {
    if (!active) return;
    const resume = () => {
      void services.location
        .startIfPermitted()
        .catch(e => setError(errorMessage(e)));
    };
    resume();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') resume();
    });
    return () => listener.remove();
  }, [active, services]);
  useEffect(() => {
    if (!active) {
      gpsRequest.current?.abort();
      searchStore.cancel();
      setAppendPlan(null);
      setSheet(null);
    }
    return () => {
      gpsRequest.current?.abort();
      searchStore.cancel();
    };
  }, [active, searchStore]);
  useEffect(() => {
    // Route/profile/session changes invalidate in-flight route-relative search results.
    searchStore.cancel();
    setDetail(null);
    setAppendPlan(null);
    setSheet(current => (current === 'search' ? null : current));
  }, [routes.route, searchStore]);
  function closeSheet() {
    gpsRequest.current?.abort();
    searchStore.cancel();
    setAppendPlan(null);
    setSheet(null);
  }
  function openAddStop() {
    const current = services.routes.getSnapshot();
    if (
      !current.route ||
      !current.plan ||
      busyRef.current ||
      navigationSession ||
      startingNavigation
    )
      return;
    if (current.plan.stops.length >= MAX_INTERMEDIATE_STOPS) {
      setError(
        `Maximum ${MAX_INTERMEDIATE_STOPS} intermediate stops reached. Remove a stop to add another.`,
      );
      return;
    }
    searchStore.clear();
    setDetail(null);
    setError(undefined);
    setAppendPlan(current.plan);
    setSheet('search');
  }
  async function appendSelectedStop(stop: Stop) {
    const current = services.routes.getSnapshot();
    if (!appendPlan || current.plan !== appendPlan || !current.route) {
      setError(
        'The route changed. Open Add Stop again to review the current route.',
      );
      return;
    }
    await calculate(appendDestination(appendPlan, stop));
  }
  function searchCenter() {
    const fix = services.location.getSnapshot().fix;
    return fix && Date.now() - fix.timestamp <= 15000
      ? { lat: fix.latitude, lng: fix.longitude }
      : undefined;
  }
  function changeQuery(value: string) {
    setError(undefined);
    setDetail(null);
    searchStore.schedule(value, searchCenter());
  }
  async function run(action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = operation.current;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (generation === operation.current) setError(errorMessage(e));
    } finally {
      if (generation === operation.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }
  function origin() {
    const fix = services.location.getFreshFix();
    if (!fix) {
      throw new DriverError('FRESH_LOCATION_REQUIRED');
    }
    return { lat: fix.latitude, lng: fix.longitude };
  }
  function refreshNavigationState() {
    setNavigation(
      guidanceSession.acceptsEvents && services.routes.getSnapshot().route
        ? { ...services.guidance.getNavigationState() }
        : { phase: 'idle' },
    );
  }
  async function startNavigation() {
    const current = services.routes.getSnapshot();
    if (!current.route || !current.plan) return;
    const truck = services.trucks.getSnapshot().selected;
    if (!truck) throw new DriverError('VERIFIED_TRUCK_REQUIRED');
    const generation = operation.current;
    setStartingNavigation(true);
    try {
      const result = await guidanceSession.start(
        current.route,
        current.plan,
        truck,
        () =>
          services.routes.getSnapshot().route === current.route &&
          services.trucks.getSnapshot().selected === truck,
      );
      if (generation !== operation.current) return;
      refreshNavigationState();
      if (result === 'unavailable')
        setError(
          'CoPilot provisioning required. Your truck route is ready, but turn-by-turn navigation cannot start until the licensed CoPilot runtime and maps are provisioned.',
        );
      if (result === 'stop-unconfirmed') {
        setStopUnconfirmed(true);
        setError(
          'Previous guidance stop is unconfirmed. Retry stopping guidance before starting another session.',
        );
      }
      if (result === 'started') setSheet('navigation');
    } finally {
      if (generation === operation.current) setStartingNavigation(false);
    }
  }
  async function toggleNavigationPause() {
    const generation = operation.current;
    await guidanceSession.pauseOrResume();
    if (generation === operation.current) refreshNavigationState();
  }
  function finishNativeStop() {
    const generation = operation.current;
    void guidanceSession.cancel().then(confirmed => {
      if (generation !== operation.current) return;
      setStopUnconfirmed(!confirmed);
      if (!confirmed)
        setError(
          'Route controls are cleared, but native guidance stop could not be confirmed. Retry stopping guidance.',
        );
    });
  }
  function confirmCancelRoute() {
    const selectedRoute = services.routes.getSnapshot().route;
    if (!selectedRoute) return;
    Alert.alert('Cancel route?', 'Your current route will be cleared.', [
      { text: 'Keep route', style: 'cancel' },
      {
        text: 'Cancel route',
        style: 'destructive',
        onPress: () => {
          if (services.routes.getSnapshot().route !== selectedRoute) return;
          ++operation.current;
          // This path is deliberately independent of the ordinary busy/start guard.
          finishNativeStop();
          gpsRequest.current?.abort();
          searchStore.clear();
          services.routes.clear();
          setNavigation({ phase: 'idle' });
          setStartingNavigation(false);
          busyRef.current = false;
          setBusy(false);
          setAcquiringGps(false);
          setDetail(null);
          setSheet(null);
          setExpanded(false);
          setError(undefined);
          Keyboard.dismiss();
        },
      },
    ]);
  }
  function confirmEndNavigation() {
    Alert.alert(
      'End navigation?',
      'Turn-by-turn guidance will stop. The planned truck route will remain available on the map.',
      [
        { text: 'Keep navigating', style: 'cancel' },
        {
          text: 'End navigation',
          style: 'destructive',
          onPress: () => {
            void run(async () => {
              const confirmed = await guidanceSession.cancel();
              refreshNavigationState();
              setStopUnconfirmed(!confirmed);
              if (!confirmed)
                setError(
                  'Native guidance stop could not be confirmed. Retry stopping guidance.',
                );
              setSheet(null);
            });
          },
        },
      ],
    );
  }
  async function calculate(plan: StopPlan, alternatives = 0) {
    // The confirmed Stop is already resolved. Retire obsolete place lookups so
    // their errors cannot hide the outcome of this independent route request.
    searchStore.cancel();
    if (navigationSession || startingNavigation) {
      setError('End navigation before changing the planned route.');
      return;
    }
    const truck = services.trucks.getSnapshot().selected;
    if (!truck) {
      throw new DriverError('VERIFIED_TRUCK_REQUIRED');
    }
    const controller = new AbortController();
    gpsRequest.current = controller;
    setAcquiringGps(true);
    try {
      await services.location.requestFreshFix(controller.signal);
      await waitForRouteForeground(controller.signal);
      // A driver may edit/sign out while GPS is being acquired. Never send the old profile.
      const selected = services.trucks.getSnapshot().selected;
      if (!selected || selected !== truck)
        throw new DriverError('VERIFIED_TRUCK_REQUIRED');
    } catch (e) {
      if (controller.signal.aborted) return;
      recordRouteFailure(
        beginRouteDiagnostic(truck, plan.stops.length + 2),
        'REQUEST_VALIDATION',
        e,
      );
      throw e;
    } finally {
      if (gpsRequest.current === controller) gpsRequest.current = null;
      setAcquiringGps(false);
    }
    // Re-read at dispatch; do not route using a fix that expired while waiting.
    if (await services.routes.calculate(origin(), plan, truck, alternatives)) {
      // Store only what the driver typed, never temporary provider geometry or a route.
      if (query.trim())
        void saveRecent(services.settings, items =>
          addRecent(items, query),
        ).catch(() =>
          setError(
            'Route ready. Recent destination could not be saved; retry when connected.',
          ),
        );
      searchStore.cancel();
      setDetail(null);
      closeSheet();
    }
  }
  const pending =
    busy || routes.phase === 'calculating' || routes.phase === 'rerouting';
  const searchPending = searchState.phase === 'loading';
  const stopEditingDisabled =
    pending || startingNavigation || navigationSession;
  const stopLimitReached =
    (routes.plan?.stops.length ?? 0) >= MAX_INTERMEDIATE_STOPS;
  function stopList() {
    if (!routes.plan) return null;
    return (
      <RouteStops
        plan={routes.plan}
        disabled={stopEditingDisabled}
        onView={stop => {
          setDetail(stop);
          setSheet('stop-detail');
        }}
        onRemove={stop => {
          void run(() => calculate(removeRouteStop(routes.plan!, stop.id)));
        }}
        onReorder={(from, to) => {
          void run(() => calculate(reorderRouteStop(routes.plan!, from, to)));
        }}
      />
    );
  }

  function search() {
    Keyboard.dismiss();
    if (query.trim().length >= 3) {
      setError(undefined);
      setDetail(null);
      void searchStore.searchNow(searchCenter());
    }
  }
  function nearby(category: PlaceCategory) {
    setError(undefined);
    setSheet('search');
    setDetail(null);
    try {
      const fix = services.location.getFreshFix();
      if (routes.route && fix)
        void searchStore.alongRoute(category, routes.route, fix);
      else void searchStore.nearby(category, origin());
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function menuAction(action: NavigationMenuAction) {
    if (action === 'weather') {
      closeSheet();
      setWeatherDetailsRequest(v => v + 1);
      return;
    }
    if (action === 'satellite') {
      setSatelliteOverride(v => !(v ?? mapPreferences(settings).satellite));
      closeSheet();
      return;
    }
    if (action === 'overview' || action === 'recenter') {
      setMapCommand(previous => ({
        type: action,
        id: (previous?.id ?? 0) + 1,
      }));
      closeSheet();
      return;
    }
    if (action === 'search') {
      setDetail(null);
      setSheet('search');
      return;
    }
    if (action === 'reroute') {
      if (navigationSession || startingNavigation) {
        Alert.alert(
          'Live rerouting unavailable',
          'Live truck-safe rerouting requires the licensed CoPilot rerouting integration. Your current route is retained. End navigation to review a new Trimble route from your current location.',
        );
        return;
      }
      const current = services.routes.getSnapshot();
      if (!current.route || !current.plan) return;
      Alert.alert(
        'Recalculate truck route?',
        'Request a new Trimble truck route from fresh GPS using your verified truck dimensions and ordered stops.',
        [
          { text: 'Keep route', style: 'cancel' },
          {
            text: 'Recalculate',
            onPress: () => {
              if (services.routes.getSnapshot().route !== current.route) return;
              void run(() => calculate(current.plan!));
            },
          },
        ],
      );
      return;
    }
    if (action === 'warnings') {
      setExpanded(true);
      closeSheet();
      return;
    }
    if (action === 'filter') {
      setSheet('filter');
      return;
    }
    if (action === 'truck') {
      closeSheet();
      onTrucks?.();
      return;
    }
    if (action === 'location') {
      setSheet('location');
      return;
    }
    if (action === 'places') {
      setSheet('places');
      return;
    }
    if (action === 'options') {
      setSheet('route');
      return;
    }
    if (action === 'continue') {
      closeSheet();
      return;
    }
    if (action === 'audio') {
      closeSheet();
      onSettings?.();
      return;
    }
    if (action === 'report') {
      closeSheet();
      onServices?.();
      return;
    }
    const snapshot = services.routes.getSnapshot();
    if (!snapshot.route || !snapshot.plan) return;
    const message = shareRouteSummary(snapshot.route, snapshot.plan);
    Alert.alert(
      'Share route summary?',
      'Destination and stop names will be included. Your current GPS location will not be shared.',
      [
        { text: 'Keep private', style: 'cancel' },
        {
          text: 'Share summary',
          onPress: () => {
            void Share.share({ message }).catch(() =>
              setError('The share sheet could not be opened.'),
            );
          },
        },
      ],
    );
  }
  function categories(compact = false, horizontal = false) {
    return (
      <View
        style={[
          styles.categories,
          compact && styles.compact,
          horizontal && styles.horizontalCategories,
        ]}
      >
        {placeShortcuts.map(item => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            disabled={pending}
            accessibilityState={{ disabled: pending }}
            onPress={() => nearby(item.category)}
            style={[
              styles.category,
              horizontal && styles.horizontalCategory,
              pending && styles.disabled,
            ]}
          >
            <View style={styles.categoryIcon}>
              <PoiCategoryPicture category={item.category} size={40} />
            </View>
            <Text
              numberOfLines={2}
              style={[styles.categoryText, { color: palette.text }]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More map features"
          onPress={() => {
            closeSheet();
            onServices?.();
          }}
          style={[styles.category, horizontal && styles.horizontalCategory]}
        >
          <View style={[styles.categoryIcon, styles.moreCategory]}>
            <DriverIcon name="more_horiz_rounded" color="#7189AC" />
          </View>
          <Text
            numberOfLines={2}
            style={[styles.categoryText, { color: palette.text }]}
          >
            More
          </Text>
        </Pressable>
      </View>
    );
  }
  const mapPrefs = mapPreferences(settings);
  const livePresentation = navigationPresentation(
    routes.route,
    navigation,
    location.fix,
  );
  const feedback = (
    <>
      <ErrorText message={error ?? searchState.error ?? routes.error} />
      {routes.diagnostic && (
        <DriverButton
          title="Route diagnostic details"
          secondary
          onPress={() => setSheet('diagnostic')}
        />
      )}
      {startingNavigation && (
        <DriverCopy>
          Starting navigation… Cancel Route remains available.
        </DriverCopy>
      )}
      {stopUnconfirmed && (
        <DriverButton
          title="Retry stopping guidance"
          onPress={finishNativeStop}
        />
      )}
      {(pending || searchPending) && (
        <View style={ds.row}>
          <ActivityIndicator color="#FF6B2C" />
          <DriverCopy>
            {acquiringGps
              ? 'Acquiring a fresh precise GPS fix…'
              : 'Requesting authoritative truck data…'}
          </DriverCopy>
        </View>
      )}
    </>
  );
  return (
    <View style={[styles.screen, { backgroundColor: palette.canvas }]}>
      <View style={styles.map}>
        <TruckMap
          token={services.environment.mapboxToken}
          command={mapCommand}
          route={routes.route}
          plan={routes.plan}
          fix={location.fix}
          navigationActive={
            navigation.phase === 'navigating' &&
            navigation.routeId === routes.route?.selectedRouteId
          }
          maneuverMeters={livePresentation?.guidance?.maneuverMeters}
          progressOffset={
            livePresentation?.guidance?.maneuverMeters !== undefined
              ? navigation.maneuverOffset
              : undefined
          }
          satellite={satelliteOverride ?? mapPrefs.satellite}
          onToggleSatellite={() =>
            setSatelliteOverride(value => !(value ?? mapPrefs.satellite))
          }
          onAudio={() => menuAction('audio')}
          autoZoom={mapPrefs.autoZoom}
          pois={pois.filter(
            poi => !hiddenCategories.includes(poi.category as PlaceCategory),
          )}
          bottomInset={bottomHeight}
          topInset={topHeight + 12}
          onCoordinate={point => {
            if (
              busy ||
              routes.phase === 'calculating' ||
              routes.phase === 'rerouting'
            )
              return;
            setDetail(null);
            setSheet('search');
            void searchStore.reverse(point);
          }}
          onPoi={poi => {
            setDetail({
              id: poi.id,
              name: poi.name,
              lat: poi.latitude,
              lng: poi.longitude,
            });
            setSheet('search');
          }}
        />
      </View>
      <View
        style={styles.top}
        pointerEvents="box-none"
        onLayout={event => setTopHeight(event.nativeEvent.layout.height)}
      >
        {routes.route ? (
          <View
            style={[
              styles.maneuverOverlay,
              !navigationSession && styles.previewOverlay,
            ]}
          >
            <NavigationHud
              route={routes.route}
              destination={routes.plan?.destination.name}
              state={navigation}
              fix={location.fix}
              metric={settings?.units === 'metric'}
              placement="maneuver"
            />
          </View>
        ) : (
          <>
            <RoutingCapabilityStatus
              api={services.api}
              verified={Boolean(trucks.selected)}
              phase={routes.phase}
              errorCode={routes.errorCode}
              color={palette.text}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review active truck"
              accessibilityHint={
                trucks.selected
                  ? 'Review truck dimensions and restrictions'
                  : 'A verified truck profile is required before routing'
              }
              onPress={onTrucks}
              style={[styles.truckChip, { backgroundColor: palette.card }]}
            >
              <DriverIcon name="local_shipping_rounded" size={18} />
              <Text
                numberOfLines={2}
                style={[styles.chipText, { color: palette.text }]}
              >
                {truckLoading
                  ? 'Loading saved truck…'
                  : truckLoadFailed
                  ? 'Truck profiles unavailable · Review'
                  : trucks.selected
                  ? trucks.selected.name +
                    ' · ' +
                    trucks.selected.heightFt +
                    ' ft H · ' +
                    trucks.selected.weightLbs.toLocaleString() +
                    ' lb · Change'
                  : 'Add truck'}
              </Text>
              {!truckLoading && !trucks.selected && (
                <DriverIcon
                  name="warning_amber_rounded"
                  size={16}
                  color="#FF6B2C"
                />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Location status"
              onPress={() => setSheet('location')}
              style={[styles.gpsChip, { backgroundColor: palette.card }]}
            >
              <DriverIcon
                name="my_location_rounded"
                size={18}
                color={palette.muted}
              />
              <Text
                numberOfLines={1}
                style={[styles.gpsText, { color: palette.text }]}
              >
                {location.fix
                  ? 'GPS ±' + Math.round(location.fix.accuracy) + ' m'
                  : location.tracking
                  ? 'Finding GPS…'
                  : 'Use my location'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      <View
        testID="map-bottom-panel"
        onLayout={event => setBottomHeight(event.nativeEvent.layout.height)}
        style={
          routes.route
            ? styles.routeBottom
            : [
                styles.bottom,
                expanded ? styles.expandedBottom : styles.collapsedBottom,
                { backgroundColor: palette.card },
              ]
        }
      >
        <WeatherStatus
          driving={navigationSession}
          detailsRequest={weatherDetailsRequest}
          services={services}
          route={routes.route}
          fix={location.fix}
        />
        {routes.route ? (
          <>
            <View
              style={[styles.routeFeedback, { backgroundColor: palette.card }]}
            >
              {feedback}
            </View>
            {!navigationSession && (
              <RoutePoiBadges
                pois={pois.filter(
                  poi =>
                    !hiddenCategories.includes(poi.category as PlaceCategory),
                )}
                fix={location.fix}
                metric={settings?.units === 'metric'}
                onSelect={poi => {
                  setDetail({
                    id: poi.id,
                    name: poi.name,
                    lat: poi.latitude,
                    lng: poi.longitude,
                  });
                  setSheet('search');
                }}
              />
            )}
            <NavigationHud
              route={routes.route}
              destination={routes.plan?.destination.name}
              state={navigation}
              fix={location.fix}
              metric={settings?.units === 'metric'}
              placement="dashboard"
              onMore={() => setSheet('navigation')}
              onReview={
                !navigationSession ? () => setSheet('route') : undefined
              }
            />
            {!navigationSession && routes.plan && (
              <View style={styles.routeActions}>
                <View style={ds.grow}>
                  <DriverButton
                    title="+ Add Stop"
                    secondary
                    disabled={stopEditingDisabled || stopLimitReached}
                    onPress={openAddStop}
                  />
                </View>
                <View style={ds.grow}>
                  <DriverButton
                    title="Stops"
                    secondary
                    onPress={() => setSheet('stops')}
                  />
                </View>
              </View>
            )}
            {!navigationSession && (
              <View style={styles.routeActions}>
                {!navigationSession && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start Navigation"
                    accessibilityState={{ disabled: pending }}
                    disabled={pending}
                    onPress={() => {
                      void run(startNavigation);
                    }}
                    style={[styles.startAction, pending && styles.disabled]}
                  >
                    <Text style={styles.startText}>Start Navigation</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel Route"
                  onPress={confirmCancelRoute}
                  style={[
                    styles.cancelAction,
                    { backgroundColor: palette.input },
                  ]}
                >
                  <Text style={[styles.cancelText, { color: palette.text }]}>
                    Cancel Route
                  </Text>
                </Pressable>
              </View>
            )}
            <RouteAdvisories
              key={
                routes.route.selectedRouteId +
                routes.route.calculatedAt +
                String(navigationSession)
              }
              services={services}
              route={routes.route}
              fix={location.fix}
              expanded={expanded}
              onOpen={() => setExpanded(true)}
              onClose={() => setExpanded(false)}
            />
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? 'Collapse map places' : 'Expand map places'
              }
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(value => !value)}
              style={styles.handleButton}
            >
              <View
                style={[styles.handle, { backgroundColor: palette.border }]}
              />
            </Pressable>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.bottomContent}
            >
              {feedback}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set destination for truck routes"
                onPress={() => {
                  setDetail(null);
                  setSheet('search');
                }}
                style={[styles.searchBar, { backgroundColor: palette.input }]}
              >
                <DriverIcon name="search_rounded" size={24} />
                <Text style={[styles.searchLabel, { color: palette.text }]}>
                  Set destination
                </Text>
                <DriverIcon
                  name="chevron_right_rounded"
                  color={palette.muted}
                />
              </Pressable>
              {expanded ? (
                <>
                  {categories()}
                  <Text style={[styles.footnote, { color: palette.muted }]}>
                    Truck entrance verification is not available. Review access
                    before departure.
                  </Text>
                </>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {categories(false, true)}
                </ScrollView>
              )}
              {!location.fix && (
                <Text style={[styles.footnote, { color: palette.muted }]}>
                  U.S. overview ·{' '}
                  {location.tracking
                    ? 'Waiting for your GPS position'
                    : 'Location off'}
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </View>
      {active && sheet === 'filter' && (
        <DriverSheet title="Places Filter" onClose={closeSheet}>
          <DriverCopy>
            Choose which loaded place categories appear on the map. This does
            not claim live availability or enable an unconfigured POI provider.
          </DriverCopy>
          {placeShortcuts.map(item => (
            <Pressable
              key={item.category}
              accessibilityRole="checkbox"
              accessibilityLabel={item.label}
              accessibilityState={{
                checked: !hiddenCategories.includes(item.category),
              }}
              onPress={() =>
                setHiddenCategories(old =>
                  old.includes(item.category)
                    ? old.filter(c => c !== item.category)
                    : [...old, item.category],
                )
              }
              style={[styles.filterRow, { backgroundColor: palette.input }]}
            >
              <PoiCategoryPicture category={item.category} size={32} />
              <Text style={[styles.filterLabel, { color: palette.text }]}>
                {item.label}
              </Text>
              <Text style={{ color: palette.text }}>
                {hiddenCategories.includes(item.category) ? '○' : '✓'}
              </Text>
            </Pressable>
          ))}
          <DriverButton
            title="Show all categories"
            onPress={() => setHiddenCategories([])}
          />
          <DriverButton title="Done" onPress={closeSheet} />
          {routes.route && (
            <DriverButton
              title="Cancel Route"
              secondary
              onPress={confirmCancelRoute}
            />
          )}
        </DriverSheet>
      )}
      {active && sheet === 'diagnostic' && routes.diagnostic && (
        <DriverSheet title="Route diagnostic" onClose={closeSheet}>
          <DriverCopy>{'Code: ' + routes.diagnostic.code}</DriverCopy>
          <DriverCopy>{'Category: ' + routes.diagnostic.category}</DriverCopy>
          <DriverCopy>
            {'Backend HTTP: ' +
              (routes.diagnostic.httpStatus ?? 'not available')}
          </DriverCopy>
          <DriverCopy>{routes.diagnostic.message}</DriverCopy>
          {routes.diagnostic.providerDetail && (
            <DriverCopy>
              {'Provider warning types: ' +
                (routes.diagnostic.providerDetail.providerWarningTypes.join(
                  ', ',
                ) || 'not supplied') +
                ' · Leg ' +
                routes.diagnostic.providerDetail.legNumber +
                ' · Report line ' +
                routes.diagnostic.providerDetail.lineNumber}
            </DriverCopy>
          )}
          <DriverCopy>
            {routes.diagnostic.providerDetailAvailable
              ? 'Provider warning identifiers are available. Their specific road restriction is not yet classified.'
              : 'The backend did not supply detailed provider warning evidence.'}
            {
              ' No addresses, truck identifiers, credentials or raw provider text are included. The route remains blocked.'
            }
          </DriverCopy>
          <DriverButton
            title="Share sanitized diagnostic"
            onPress={() => {
              void Share.share({
                message: JSON.stringify(
                  { ...routes.diagnostic, events: routeDiagnosticHistory() },
                  null,
                  2,
                ),
              }).catch(() => setError('The share sheet could not be opened.'));
            }}
          />
        </DriverSheet>
      )}
      {active && sheet === 'location' && (
        <DriverSheet title="Location" onClose={() => closeSheet()}>
          {routes.route && (
            <DriverButton
              title="Cancel Route"
              secondary
              onPress={confirmCancelRoute}
            />
          )}
          <DriverCopy>
            {location.fix
              ? 'GPS accuracy ±' + Math.round(location.fix.accuracy) + ' m'
              : 'Waiting for a precise location. No location is assumed.'}
          </DriverCopy>
          <ErrorText message={location.error} />
          {feedback}
          <DriverButton
            title={
              location.tracking ? 'Stop location' : 'Enable precise location'
            }
            disabled={pending}
            onPress={() => {
              void run(() =>
                location.tracking
                  ? services.location.stop()
                  : services.location.start(),
              );
            }}
          />
        </DriverSheet>
      )}
      {active && sheet === 'places' && (
        <DriverSheet title="POI Ahead" onClose={closeSheet}>
          {routes.route && (
            <DriverButton
              title="Cancel Route"
              secondary
              onPress={confirmCancelRoute}
            />
          )}
          <DriverCopy>
            Choose a truck category. Results require an approved provider;
            missing coverage is not replaced with passenger businesses.
            Route-ahead search requires fresh GPS.
          </DriverCopy>
          {categories()}
        </DriverSheet>
      )}
      {active && sheet === 'search' && (
        <DriverSheet
          title={appendPlan ? 'Add Stop' : 'Set destination'}
          onClose={() => closeSheet()}
        >
          {appendPlan && (
            <DriverCopy>
              Choose the next stop after {appendPlan.destination.name}. Your
              existing stops will be kept.
            </DriverCopy>
          )}
          {routes.route && (
            <DriverButton
              title="Cancel Route"
              secondary
              onPress={confirmCancelRoute}
            />
          )}
          <View
            style={[styles.searchInput, { backgroundColor: palette.input }]}
          >
            <DriverIcon name="search_rounded" />
            <TextInput
              keyboardAppearance={palette.dark ? 'dark' : 'light'}
              accessibilityLabel="Search address or destination"
              placeholder="Set destination for truck routes"
              placeholderTextColor={palette.muted}
              value={query}
              onChangeText={changeQuery}
              maxLength={256}
              editable={
                !busy &&
                routes.phase !== 'calculating' &&
                routes.phase !== 'rerouting'
              }
              returnKeyType="search"
              onSubmitEditing={search}
              style={[styles.input, { color: palette.text }]}
            />
          </View>
          {recentDestinations(settings).length > 0 && !detail && (
            <>
              <DriverTitle small>Recent</DriverTitle>
              <DriverCopy>
                Saved destination searches. Each selection resolves a fresh
                address; no previous route is reused.
              </DriverCopy>
              <ScrollView
                style={styles.recentList}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {recentDestinations(settings, query).map(value => (
                  <View key={value} style={ds.row}>
                    <View style={ds.grow}>
                      <DriverButton
                        title={value}
                        secondary
                        disabled={pending}
                        onPress={() => {
                          changeQuery(value);
                          void searchStore.searchNow(searchCenter());
                        }}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={'Remove from Recent: ' + value}
                      style={styles.removeRecent}
                      onPress={() => {
                        void run(() =>
                          saveRecent(services.settings, items =>
                            items.filter(item => item !== value),
                          ),
                        );
                      }}
                    >
                      <DriverIcon name="close_rounded" color={palette.muted} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              {!!query && (
                <DriverButton
                  title="Show all recent destinations"
                  secondary
                  onPress={() => changeQuery('')}
                />
              )}
              <DriverButton
                title="Clear History"
                secondary
                disabled={pending}
                onPress={() =>
                  Alert.alert(
                    'Clear destination history?',
                    'Your saved truck profile and current route will be kept.',
                    [
                      { text: 'Keep history', style: 'cancel' },
                      {
                        text: 'Clear History',
                        style: 'destructive',
                        onPress: () => {
                          void run(() =>
                            saveRecent(services.settings, () => []),
                          );
                        },
                      },
                    ],
                  )
                }
              />
            </>
          )}
          <DriverButton
            title="Search"
            loading={searchPending}
            disabled={pending || query.trim().length < 3}
            onPress={search}
          />
          <DriverButton
            title="Ask driver assistant"
            loading={searchPending}
            disabled={pending || !query.trim()}
            secondary
            onPress={() => {
              setDetail(null);
              void searchStore.command(query, {
                fix: services.location.getFreshFix(),
                route: services.routes.getSnapshot().route,
              });
            }}
          />
          <DriverCopy>
            Ask for a truck stop, CAT Scale, repair shop, cheapest diesel on
            your route, or weather 50/100 miles ahead. Speech capture is
            unavailable; keyboard dictation is not verified hands-free
            operation.
          </DriverCopy>
          {categories(true)}
          <CorridorRecords items={searchState.advisories ?? []} />
          <DriverCopy>
            Addresses: Mapbox. Truck places: SemiTraX place provider. Neither
            result verifies a truck entrance.
          </DriverCopy>
          {searchState.phase === 'waiting' && (
            <DriverCopy>Waiting for your address…</DriverCopy>
          )}
          {!detail && feedback}
          {!pending &&
            !searchPending &&
            searchState.phase !== 'waiting' &&
            !detail &&
            results.length === 0 &&
            pois.length === 0 && (
              <DriverEmpty
                icon="route_rounded"
                title={
                  searched ? 'No places returned' : 'Where are you hauling to?'
                }
                message={
                  searched
                    ? 'Try another address or category. Check the error above if the request failed.'
                    : 'Search a city or address, or choose a truck-place category above.'
                }
              />
            )}
          {!detail && results.length > 0 && (
            <DriverTitle small>Search results</DriverTitle>
          )}
          {!detail &&
            results.map(stop => (
              <DriverCard key={stop.id} onPress={() => setDetail(stop)}>
                <View style={ds.row}>
                  <DriverIcon name="map_outlined" color="#2374E1" />
                  <View style={ds.grow}>
                    <DriverTitle small>{stop.name}</DriverTitle>
                  </View>
                  <DriverIcon name="chevron_right_rounded" />
                </View>
              </DriverCard>
            ))}
          {!detail &&
            pois.map(poi => (
              <DriverCard
                key={poi.id}
                onPress={() =>
                  setDetail({
                    id: poi.id,
                    name: poi.name,
                    lat: poi.latitude,
                    lng: poi.longitude,
                  })
                }
              >
                <View style={ds.row}>
                  <PoiArtwork poi={poi} />
                  <View style={ds.grow}>
                    <DriverTitle small>{poi.name}</DriverTitle>
                    <DriverCopy>{poiDetails(poi)}</DriverCopy>
                  </View>
                </View>
              </DriverCard>
            ))}
          {detail && (
            <DriverCard>
              <DriverButton
                title="Back to results"
                secondary
                onPress={() => setDetail(null)}
              />
              <DriverTitle small>{detail.name}</DriverTitle>
              {pois.find(poi => poi.id === detail.id) && (
                <DriverCopy>
                  {poiDetails(pois.find(poi => poi.id === detail.id)!)}
                </DriverCopy>
              )}
              <DriverCopy>
                Confirm the destination and truck access before departure.
              </DriverCopy>
              {feedback}
              <DriverButton
                title={
                  appendPlan
                    ? 'Add Stop & recalculate'
                    : 'Set final destination'
                }
                disabled={stopEditingDisabled || !trucks.selected}
                onPress={() => {
                  void run(() =>
                    appendPlan
                      ? appendSelectedStop(detail)
                      : calculate(createStopPlan(detail)),
                  );
                }}
              />
              {!trucks.selected && (
                <DriverButton
                  title="Add truck profile to plan route"
                  disabled={!onTrucks}
                  onPress={() => {
                    closeSheet();
                    onTrucks?.();
                  }}
                />
              )}
              {routes.plan && !appendPlan && (
                <DriverButton
                  title="Add stop to current route"
                  secondary
                  disabled={stopEditingDisabled}
                  onPress={() => {
                    void run(() =>
                      calculate(appendDestination(routes.plan!, detail)),
                    );
                  }}
                />
              )}
            </DriverCard>
          )}
        </DriverSheet>
      )}
      {active && sheet === 'stops' && routes.route && routes.plan && (
        <DriverSheet title="Route Stops" onClose={closeSheet}>
          {feedback}
          <DriverButton
            title="+ Add Stop"
            secondary
            disabled={stopEditingDisabled || stopLimitReached}
            onPress={openAddStop}
          />
          {stopList()}
        </DriverSheet>
      )}
      {active && sheet === 'stop-detail' && detail && routes.route && (
        <DriverSheet
          title="Stop details"
          onClose={() => {
            setDetail(null);
            setSheet('stops');
          }}
        >
          <DriverTitle small>{detail.name}</DriverTitle>
          <DriverCopy>
            This is a stop on your planned route. A destination result does not
            verify a truck entrance. Review access before departure.
          </DriverCopy>
          <DriverButton
            title="Back to stops"
            secondary
            onPress={() => {
              setDetail(null);
              setSheet('stops');
            }}
          />
        </DriverSheet>
      )}
      {active && sheet === 'route' && routes.route && (
        <DriverSheet title="Route Options" onClose={() => closeSheet()}>
          <DriverButton
            title="Cancel Route"
            secondary
            onPress={confirmCancelRoute}
          />
          {feedback}
          <RoutePreview
            route={routes.route}
            metric={settings?.units === 'metric'}
          />
          {routes.plan && (
            <DriverCard>
              <DriverTitle small>Ordered stops</DriverTitle>
              <DriverButton
                title="+ Add Stop"
                secondary
                disabled={stopEditingDisabled || stopLimitReached}
                onPress={openAddStop}
              />
              {stopList()}
              <DriverButton
                title="Compare alternatives"
                disabled={pending}
                onPress={() => {
                  void run(() => calculate(routes.plan!, 2));
                }}
              />
              <DriverButton
                title="Recalculate from current location"
                disabled={pending}
                onPress={() => {
                  void run(() => calculate(routes.plan!));
                }}
              />
            </DriverCard>
          )}
          <DriverButton
            title={
              navigationSession
                ? 'Open Navigation Controls'
                : 'Start Navigation'
            }
            disabled={pending}
            onPress={() => {
              if (navigationSession) {
                setSheet('navigation');
              } else {
                void run(startNavigation);
              }
            }}
          />
          <DriverCopy>
            Start Navigation stays available even before provisioning. If the
            licensed CoPilot runtime or maps are unavailable, SemiTraX will fail
            closed and keep this route in preview mode instead of starting fake
            or passenger-car guidance.
          </DriverCopy>
        </DriverSheet>
      )}
      {active && sheet === 'navigation' && routes.route && (
        <NavigationPanel
          onClose={closeSheet}
          header={
            <NavigationHud
              route={routes.route}
              destination={routes.plan?.destination.name}
              state={navigation}
              fix={location.fix}
              metric={settings?.units === 'metric'}
              placement="panel"
            />
          }
          footer={
            <>
              {navigationSession ? (
                <NavigationAction
                  title="Quit Nav"
                  label="End Navigation"
                  secondary
                  disabled={pending}
                  onPress={confirmEndNavigation}
                />
              ) : (
                <NavigationAction
                  title="Cancel Route"
                  secondary
                  onPress={confirmCancelRoute}
                />
              )}
              <NavigationAction
                title={
                  navigation.phase === 'paused'
                    ? 'Resume Navigation'
                    : navigationSession
                    ? 'Continue Navigation'
                    : 'Start Navigation'
                }
                disabled={pending}
                onPress={() => {
                  if (navigation.phase === 'paused') {
                    void run(toggleNavigationPause);
                  } else if (navigationSession) closeSheet();
                  else void run(startNavigation);
                }}
              />
            </>
          }
        >
          {feedback}
          <NavigationMenu phase={navigation.phase} onAction={menuAction} />
          <Text style={[styles.panelStatus, { color: palette.muted }]}>
            {!navigationSession
              ? startingNavigation
                ? 'Starting navigation…'
                : 'Truck route ready'
              : navigation.phase === 'arrived'
              ? 'Destination reached'
              : navigation.phase === 'paused'
              ? 'Navigation paused'
              : navigation.phase === 'rerouting'
              ? 'Truck-safe reroute in progress'
              : 'Turn-by-turn navigation active'}
          </Text>
          {navigationSession &&
            navigation.phase !== 'arrived' &&
            navigation.phase !== 'paused' && (
              <NavigationAction
                title={
                  navigation.phase === 'rerouting'
                    ? 'Rerouting…'
                    : 'Pause Navigation'
                }
                secondary
                disabled={pending || navigation.phase !== 'navigating'}
                onPress={() => {
                  void run(toggleNavigationPause);
                }}
              />
            )}
          {navigationSession && (
            <NavigationAction
              title="Cancel Route"
              secondary
              onPress={confirmCancelRoute}
            />
          )}

          <Text style={[styles.panelStatus, { color: palette.muted }]}>
            {navigationSession
              ? 'Quit Nav stops guidance after confirmation and retains the route. Cancel Route clears it.'
              : 'Route preview only. Start Navigation checks CoPilot licensing and maps.'}
          </Text>
        </NavigationPanel>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  recentList: { maxHeight: 220 },
  removeRecent: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maneuverOverlay: { flex: 1, marginRight: 62 },
  previewOverlay: { marginRight: 0 },
  routeBottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    gap: 8,
  },
  routeFeedback: { borderRadius: 12 },
  routeActions: { flexDirection: 'row', gap: 8 },
  startAction: {
    flex: 1,
    backgroundColor: '#FF6425',
    padding: 12,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startText: { color: 'white', fontWeight: '900', fontSize: 16 },
  cancelAction: {
    backgroundColor: '#1B2732',
    borderWidth: 1,
    borderColor: '#445361',
    padding: 12,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: { color: '#E8BDB1', fontWeight: '800', fontSize: 14 },
  advisory: { maxHeight: 160, borderRadius: 12, backgroundColor: '#FFFFFFE8' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    minHeight: 52,
    gap: 12,
    borderRadius: 14,
  },
  filterLabel: { flex: 1, fontSize: 16, fontWeight: '700' },
  panelStatus: { color: '#A9BCCA', fontSize: 14, lineHeight: 20 },
  cancelFooter: { paddingHorizontal: 16, paddingBottom: 10 },
  moreCategory: { backgroundColor: '#7189AC1A' },
  screen: { flex: 1 },
  map: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  top: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  truckChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 40,
    borderRadius: 14,
    flexShrink: 1,
    maxWidth: '52%',
    elevation: 2,
  },
  chipText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  gpsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 40,
    borderRadius: 14,
    flexShrink: 1,
  },
  gpsText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    boxShadow: '0 -6px 24px #1018203D',
  },
  navigationBottom: { maxHeight: '60%' },
  collapsedBottom: { maxHeight: '35%' },
  expandedBottom: { maxHeight: '46%' },
  handleButton: { height: 28, alignItems: 'center', justifyContent: 'center' },
  horizontalCategories: { flexWrap: 'nowrap' },
  horizontalCategory: { width: 88 },
  handle: { width: 42, height: 4, borderRadius: 99, alignSelf: 'center' },
  bottomContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 10,
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    minHeight: 48,
    borderRadius: 15,
  },
  searchLabel: { fontSize: 15, fontWeight: '700', flex: 1 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  compact: { marginVertical: 4 },
  category: {
    width: '25%',
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingHorizontal: 3,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  footnote: { fontSize: 10, lineHeight: 15 },
  routeTitle: { fontWeight: '900', fontSize: 15 },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  input: { flex: 1, minHeight: 54, fontSize: 16 },
  disabled: { opacity: 0.4 },
});
