import { applyGuidanceEvent } from '../features/navigation/guidanceEvents';
import { RouteAdvisories } from '../features/navigation/RouteAdvisories';
import { NavigationHud } from '../features/navigation/NavigationHud';
import { ArrivalSummary } from '../features/navigation/ArrivalSummary';
import {
  isNavigationSession,
  navigationPresentation,
} from '../features/navigation/navigationPresentation';
import {
  clearRouteSession,
  tripShareMessage,
} from '../features/navigation/navigationActions';
import { mapPreferences } from '../features/settings/mapPreferences';
import { isNightAtLocation } from '../features/map/dayNight';
import { RoutingCapabilityStatus } from '../components/RoutingCapabilityStatus';
import { CorridorRecords } from '../features/dot511/CorridorRecords';
import { DriverError } from '../errors/driverErrors';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
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
  addStop,
  createStopPlan,
  removeStop,
  reorderStop,
  type Stop,
  type StopPlan,
} from '../features/stops/StopPlan';
import { type PlaceCategory } from '../features/poi/PoiService';
import {
  PoiArtwork,
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
  onNavigationSessionChange,
  active = true,
}: {
  services: Services;
  onTrucks?: () => void;
  onServices?: () => void;
  onSettings?: () => void;
  onNavigationSessionChange?: (active: boolean) => void;
  active?: boolean;
}) {
  const routes = useStore(services.routes),
    trucks = useStore(services.trucks),
    location = useStore(services.location);
  const scheme = useColorScheme();
  const { settings } = useStore(services.settings);
  const [searchStore] = useState(
    () => new DestinationSearchStore(services.search, services.poi),
  );
  const searchState = useStore(searchStore);
  const { query, results, pois } = searchState;
  const [busy, setBusy] = useState(false);
  const [acquiringGps, setAcquiringGps] = useState(false);
  const gpsRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<
    | 'search'
    | 'route'
    | 'location'
    | 'navigation'
    | 'poiAhead'
    | 'placesFilter'
    | 'audio'
    | 'arrival'
    | null
  >(null);
  const [detail, setDetail] = useState<Stop | null>(null);
  const searched = searchState.phase === 'ready';
  const [expanded, setExpanded] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(164);
  const [topHeight, setTopHeight] = useState(44);
  const [overviewRequest, setOverviewRequest] = useState(0);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const [guidanceStopUncertain, setGuidanceStopUncertain] = useState(false);
  const [navigationStarting, setNavigationStarting] = useState(false);
  const [cancellingRoute, setCancellingRoute] = useState(false);
  const navigationStartGeneration = useRef(0);
  const navigationStartInFlight = useRef(false);
  const [placeFilter, setPlaceFilter] = useState<Set<PlaceCategory>>(
    () => new Set(placeShortcuts.map(item => item.category)),
  );
  const busyRef = useRef(false);
  const [navigation, setNavigation] = useState(() =>
    services.guidance.getNavigationState(),
  );
  const navigationSession = isNavigationSession(navigation);
  const palette = useDriverPalette();
  useEffect(() => {
    onNavigationSessionChange?.(navigationSession);
  }, [navigationSession, onNavigationSessionChange]);
  useEffect(() => {
    void services.trucks.load().catch(e => setError(errorMessage(e)));
    void services.settings.load().catch(e => setError(errorMessage(e)));
  }, [services]);
  useEffect(() => {
    setNavigation({ ...services.guidance.getNavigationState() });
    return services.guidance.subscribe(event => {
      setNavigation(previous =>
        applyGuidanceEvent(
          previous,
          services.guidance.getNavigationState(),
          event,
          services.routes.getSnapshot().route,
        ),
      );
    });
  }, [services]);
  useEffect(() => {
    if (
      active &&
      navigation.phase === 'arrived' &&
      routes.route &&
      routes.plan
    ) {
      setSheet(current => (current === 'arrival' ? current : 'arrival'));
    }
  }, [active, navigation.phase, routes.plan, routes.route]);
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
  }, [routes.route, searchStore]);
  function closeSheet() {
    gpsRequest.current?.abort();
    searchStore.cancel();
    setSheet(null);
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
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      busyRef.current = false;
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
    setNavigation({ ...services.guidance.getNavigationState() });
  }
  async function startNavigation() {
    if (guidanceStopUncertain) {
      if (navigationStartInFlight.current) {
        setError(
          'The previous navigation start is still settling after cancellation. Wait for it to finish before starting another session.',
        );
        return;
      }
      if (isNavigationSession(services.guidance.getNavigationState())) {
        setError(
          'The previous native guidance session did not confirm it stopped. Retry after CoPilot is idle before starting another navigation session.',
        );
        return;
      }
      setGuidanceStopUncertain(false);
    }
    if (!routes.route || !routes.plan) {
      setError('Calculate a truck route before starting navigation.');
      return;
    }
    const routeAtStart = routes.route;
    const planAtStart = routes.plan;
    const truck = services.trucks.getSnapshot().selected;
    if (!truck) throw new DriverError('VERIFIED_TRUCK_REQUIRED');

    const attempt = ++navigationStartGeneration.current;
    navigationStartInFlight.current = true;
    setNavigationStarting(true);
    const cancelled = () => navigationStartGeneration.current !== attempt;
    const routeChanged = () =>
      services.routes.getSnapshot().route !== routeAtStart ||
      services.routes.getSnapshot().plan !== planAtStart;
    const truckChanged = () => services.trucks.getSnapshot().selected !== truck;

    try {
      const capability = await services.guidance.initialize();
      refreshNavigationState();
      if (cancelled()) return;
      if (!capability.available) {
        setError(
          'CoPilot provisioning required. Your truck route is ready, but turn-by-turn navigation cannot start until the licensed CoPilot runtime and maps are provisioned.',
        );
        return;
      }
      if (routeChanged()) return;
      if (truckChanged()) throw new DriverError('VERIFIED_TRUCK_REQUIRED');

      await services.guidance.setTruckProfile(truck);
      if (cancelled() || routeChanged()) return;
      if (truckChanged()) throw new DriverError('VERIFIED_TRUCK_REQUIRED');

      await services.guidance.setRoute(routeAtStart, planAtStart);
      if (cancelled() || routeChanged()) return;
      if (truckChanged()) throw new DriverError('VERIFIED_TRUCK_REQUIRED');

      await services.guidance.startNavigation();
      if (cancelled() || routeChanged()) {
        try {
          await services.guidance.stopNavigation();
          setGuidanceStopUncertain(false);
        } catch {
          setGuidanceStopUncertain(true);
        }
        setNavigation({ phase: 'idle' });
        return;
      }
      refreshNavigationState();
      setSheet('navigation');
    } catch (e) {
      // A cancelled start must not surface a late native/provider failure after
      // the driver has already cleared the route. Real, non-cancelled failures
      // still propagate to the normal error UI.
      if (!cancelled()) throw e;
    } finally {
      navigationStartInFlight.current = false;
      if (navigationStartGeneration.current === attempt)
        setNavigationStarting(false);
    }
  }
  async function toggleNavigationPause() {
    if (navigation.phase === 'paused') {
      await services.guidance.resumeNavigation();
    } else if (navigation.phase === 'navigating') {
      await services.guidance.pauseNavigation();
    } else {
      return;
    }
    refreshNavigationState();
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
              await services.guidance.stopNavigation();
              refreshNavigationState();
              setSheet(null);
            });
          },
        },
      ],
    );
  }
  async function finishArrivedRoute() {
    if (navigation.phase !== 'arrived') return;

    ++navigationStartGeneration.current;
    setNavigationStarting(false);
    setCancellingRoute(true);
    setError(undefined);

    try {
      const result = await clearRouteSession(services.guidance, services.routes);
      const nativeStillActive = isNavigationSession(
        services.guidance.getNavigationState(),
      );
      const uncertain = result.stopFailed || nativeStillActive;
      setGuidanceStopUncertain(uncertain);
      setNavigation({ phase: 'idle' });
      setExpanded(false);
      setDetail(null);
      searchStore.cancel();
      setSheet(null);
      if (uncertain) {
        setError(
          'Completed route cleared. Native guidance did not yet confirm it is idle; SemiTraX will not start another navigation session until that is confirmed.',
        );
      }
    } catch (e) {
      setGuidanceStopUncertain(true);
      setError(errorMessage(e));
    } finally {
      setCancellingRoute(false);
    }
  }

  function confirmCancelRoute() {
    Alert.alert('Cancel route?', 'Your current route will be cleared.', [
      { text: 'Keep route', style: 'cancel' },
      {
        text: 'Cancel route',
        style: 'destructive',
        onPress: () => {
          if (cancellingRoute) return;

          // Invalidate every in-flight navigation startup before touching native guidance.
          ++navigationStartGeneration.current;
          const startWasInFlight = navigationStartInFlight.current;
          const nativeWasActive = isNavigationSession(
            services.guidance.getNavigationState(),
          );
          setNavigationStarting(false);
          setCancellingRoute(true);
          setGuidanceStopUncertain(startWasInFlight || nativeWasActive);

          // Clear all local route-bound UI immediately. Cancellation must remain
          // usable while startup/reroute/provider work is pending.
          gpsRequest.current?.abort();
          searchStore.cancel();
          setDetail(null);
          setExpanded(false);
          setSheet(null);
          setNavigation({ phase: 'idle' });
          setError(undefined);

          void clearRouteSession(services.guidance, services.routes)
            .then(result => {
              const nativeStillActive = isNavigationSession(
                services.guidance.getNavigationState(),
              );
              const uncertain =
                result.stopFailed ||
                nativeStillActive ||
                (startWasInFlight && !result.stopAttempted);
              setGuidanceStopUncertain(uncertain);
              if (uncertain) {
                setError(
                  'Route cleared. Native guidance did not yet confirm it is idle; SemiTraX will not start another navigation session until that is confirmed.',
                );
              }
            })
            .catch(() => {
              setGuidanceStopUncertain(true);
              setError(
                'Route cleared. Native guidance stop could not be confirmed; SemiTraX will not start another navigation session until guidance is idle.',
              );
            })
            .finally(() => setCancellingRoute(false));
        },
      },
    ]);
  }
  async function shareTrip() {
    const route = services.routes.getSnapshot().route;
    const plan = services.routes.getSnapshot().plan;
    if (!route || !plan) {
      setError('Calculate a truck route before sharing the trip.');
      return;
    }
    await Share.share({
      message: tripShareMessage(route, plan, settings?.units === 'metric'),
    });
  }
  async function saveMapPreferences(
    change: Partial<{
      satellite: boolean;
      autoZoom: boolean;
      autoDayNight: boolean;
    }>,
  ) {
    const current = services.settings.getSnapshot().settings;
    if (!current) {
      throw new Error('Navigation settings are not loaded yet.');
    }
    const currentMap = mapPreferences(current);
    await services.settings.save({
      ...current,
      settingsJson: {
        ...(current.settingsJson ?? {}),
        rnMap: { ...currentMap, ...change },
      },
    });
  }
  async function saveAudioPreferences(
    change: Partial<{ voiceEnabled: boolean; voiceMuted: boolean }>,
  ) {
    const current = services.settings.getSnapshot().settings;
    if (!current) {
      throw new Error('Navigation settings are not loaded yet.');
    }
    await services.settings.save({ ...current, ...change });
  }
  function togglePlaceFilter(category: PlaceCategory) {
    setPlaceFilter(current => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }
  async function calculate(plan: StopPlan, alternatives = 0) {
    if (navigationSession) {
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
      if (controller.signal.aborted || AppState.currentState !== 'active')
        return;
      // A driver may edit/sign out while GPS is being acquired. Never send the old profile.
      const selected = services.trucks.getSnapshot().selected;
      if (!selected || selected !== truck)
        throw new DriverError('VERIFIED_TRUCK_REQUIRED');
    } catch (e) {
      if (controller.signal.aborted) return;
      throw e;
    } finally {
      if (gpsRequest.current === controller) gpsRequest.current = null;
      setAcquiringGps(false);
    }
    // Re-read at dispatch; do not route using a fix that expired while waiting.
    if (await services.routes.calculate(origin(), plan, truck, alternatives)) {
      searchStore.cancel();
      setDetail(null);
      closeSheet();
    }
  }
  const pending =
    busy ||
    routes.phase === 'calculating' ||
    routes.phase === 'rerouting' ||
    searchState.phase === 'loading';
  const mapPrefs = mapPreferences(settings);
  const lightingFix =
    location.fix && Date.now() - location.fix.timestamp <= 30 * 60 * 1000
      ? location.fix
      : null;
  const solarNight =
    mapPrefs.autoDayNight && lightingFix
      ? isNightAtLocation(
          new Date(),
          lightingFix.latitude,
          lightingFix.longitude,
        )
      : null;
  const night =
    settings?.dayNightMode === 'night' ||
    (settings?.dayNightMode !== 'day' &&
      (solarNight === null ? scheme === 'dark' : solarNight));

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
  function driverAssistant(text: string) {
    setError(undefined);
    setDetail(null);
    setSheet('search');
    void searchStore.command(text, {
      fix: services.location.getFreshFix(),
      route: services.routes.getSnapshot().route,
    });
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
        {placeShortcuts
          .filter(item => placeFilter.has(item.category))
          .map(item => (
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
            <View
              style={[
                styles.categoryIcon,
                { backgroundColor: item.color + '1A' },
              ]}
            >
              <DriverIcon name={item.icon} color={item.color} size={24} />
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
  const livePresentation = navigationPresentation(
    routes.route,
    navigation,
    location.fix,
  );
  const navigationDistance =
    livePresentation?.remainingMeters !== undefined
      ? settings?.units === 'metric'
        ? (livePresentation?.remainingMeters / 1000).toFixed(1) + ' km'
        : (livePresentation?.remainingMeters / 1609.344).toFixed(1) + ' mi'
      : undefined;
  const navigationDuration =
    livePresentation?.remainingSeconds !== undefined
      ? Math.max(1, Math.ceil(livePresentation?.remainingSeconds / 60)) + 'm'
      : undefined;
  const navigationSummary = [navigationDistance, navigationDuration]
    .filter(Boolean)
    .join(' · ');
  const feedback = (
    <>
      <ErrorText message={error ?? searchState.error ?? routes.error} />
      {pending && (
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
          route={routes.route}
          plan={routes.plan}
          fix={location.fix}
          night={night}
          navigationActive={
            navigation.phase === 'navigating' &&
            navigation.routeId === routes.route?.selectedRouteId
          }
          maneuverMeters={livePresentation?.guidance?.maneuverMeters}
          progressOffset={livePresentation?.guidance?.maneuverMeters!==undefined?navigation.maneuverOffset:undefined}
          satellite={mapPrefs.satellite}
          autoZoom={mapPrefs.autoZoom}
          pois={pois.filter(
            poi =>
              !poi.category ||
              placeFilter.has(poi.category as PlaceCategory),
          )}
          overviewRequest={overviewRequest}
          recenterRequest={recenterRequest}
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
            numberOfLines={1}
            style={[styles.chipText, { color: palette.text }]}
          >
            {trucks.selected ? trucks.selected.name : 'Add truck'}
          </Text>
          {!trucks.selected && (
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
      </View>
      <View
        testID="map-bottom-panel"
        onLayout={event => setBottomHeight(event.nativeEvent.layout.height)}
        style={[
          styles.bottom,
          navigationSession
            ? styles.navigationBottom
            : expanded
            ? styles.expandedBottom
            : styles.collapsedBottom,
          { backgroundColor: palette.card },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Collapse map places' : 'Expand map places'
          }
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          style={styles.handleButton}
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </Pressable>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.bottomContent}
        >
          {feedback}
          {routes.route ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                navigationSession
                  ? 'Open navigation controls'
                  : 'Review route and stops'
              }
              onPress={() =>
                setSheet(navigationSession ? 'navigation' : 'route')
              }
              style={ds.row}
            >
              <DriverIcon name="route_rounded" color="#0B68E8" size={26} />
              <View style={ds.grow}>
                <NavigationHud
                  route={routes.route}
                  state={navigation}
                  fix={location.fix}
                  metric={settings?.units === 'metric'}
                />
              </View>
              <DriverIcon name="chevron_right_rounded" color={palette.text} />
            </Pressable>
          ) : (
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
              <Text
                numberOfLines={1}
                style={[styles.searchLabel, { color: palette.text }]}
              >
                Set destination
              </Text>
              <DriverIcon name="chevron_right_rounded" color={palette.muted} />
            </Pressable>
          )}
          {routes.route && !navigationSession && (
            <DriverButton
              title={navigationStarting ? 'Starting Navigation…' : 'Start Navigation'}
              disabled={pending}
              onPress={() => {
                void run(startNavigation);
              }}
            />
          )}
          {navigationSession && (
            <DriverButton
              title="Navigation Controls"
              disabled={pending}
              onPress={() => setSheet('navigation')}
            />
          )}
          {routes.route && (
            <DriverButton
              title={
                navigationSession || navigationStarting
                  ? 'Cancel Route / Navigation'
                  : 'Cancel Route'
              }
              secondary
              disabled={cancellingRoute}
              onPress={confirmCancelRoute}
            />
          )}
          {guidanceStopUncertain && (
            <DriverButton
              title="Retry Stop Guidance"
              secondary
              disabled={pending}
              onPress={() => {
                void run(async () => {
                  await services.guidance.stopNavigation();
                  setGuidanceStopUncertain(false);
                  setNavigation({ phase: 'idle' });
                });
              }}
            />
          )}
          {routes.route && (
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
            />
          )}
          {expanded ? (
            <>
              {routes.route && !navigationSession && (
                <DriverButton
                  title="Change destination"
                  secondary
                  onPress={() => {
                    setDetail(null);
                    setSheet('search');
                  }}
                />
              )}
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
      </View>
      {active && sheet === 'location' && (
        <DriverSheet title="Location" onClose={() => closeSheet()}>
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
      {active && sheet === 'search' && (
        <DriverSheet title="Set destination" onClose={() => closeSheet()}>
          <View
            style={[styles.searchInput, { backgroundColor: palette.input }]}
          >
            <DriverIcon name="search_rounded" />
            <TextInput
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
          <DriverButton
            title="Search"
            disabled={pending || query.trim().length < 3}
            onPress={search}
          />
          <DriverButton
            title="Ask driver assistant"
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
          {feedback}
          {!pending &&
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
              <DriverButton
                title="Set final destination"
                disabled={pending || !trucks.selected}
                onPress={() => {
                  void run(() => calculate(createStopPlan(detail)));
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
              {routes.plan && (
                <DriverButton
                  title="Add stop to current route"
                  secondary
                  disabled={pending}
                  onPress={() => {
                    void run(() => calculate(addStop(routes.plan!, detail)));
                  }}
                />
              )}
            </DriverCard>
          )}
        </DriverSheet>
      )}
      {active && sheet === 'poiAhead' && routes.route && (
        <DriverSheet title="POI Ahead" onClose={() => closeSheet()}>
          <DriverCopy>
            Choose a truck-place category. Results are requested along the
            accepted route and ordered by provider-reported distance ahead.
            Missing results do not mean a service is unavailable.
          </DriverCopy>
          {categories(true)}
          {feedback}
        </DriverSheet>
      )}
      {active && sheet === 'placesFilter' && (
        <DriverSheet title="Places Filter" onClose={() => closeSheet()}>
          <DriverCopy>
            Controls which truck-place shortcuts and returned POI markers are
            shown. It does not change routing or verify truck access.
          </DriverCopy>
          {placeShortcuts.map(item => (
            <DriverButton
              key={item.category}
              title={(placeFilter.has(item.category) ? '✓ ' : '') + item.label}
              secondary
              onPress={() => togglePlaceFilter(item.category)}
            />
          ))}
          <DriverButton
            title="Show All Truck Places"
            secondary
            onPress={() =>
              setPlaceFilter(new Set(placeShortcuts.map(item => item.category)))
            }
          />
          <DriverButton
            title="Hide All Truck Places"
            secondary
            onPress={() => setPlaceFilter(new Set())}
          />
        </DriverSheet>
      )}
      {active && sheet === 'audio' && (
        <DriverSheet title="Audio Settings" onClose={() => closeSheet()}>
          <DriverCopy>
            These preferences are saved to your SemiTraX account. Actual spoken
            turn guidance remains dependent on licensed CoPilot guidance.
          </DriverCopy>
          {settings ? (
            <>
              <DriverButton
                title={
                  settings.voiceEnabled
                    ? 'Turn Voice Guidance Off'
                    : 'Turn Voice Guidance On'
                }
                secondary
                disabled={pending}
                onPress={() => {
                  void run(() =>
                    saveAudioPreferences({
                      voiceEnabled: !settings.voiceEnabled,
                    }),
                  );
                }}
              />
              <DriverButton
                title={settings.voiceMuted ? 'Unmute Guidance' : 'Mute Guidance'}
                secondary
                disabled={pending || !settings.voiceEnabled}
                onPress={() => {
                  void run(() =>
                    saveAudioPreferences({ voiceMuted: !settings.voiceMuted }),
                  );
                }}
              />
              <DriverCopy>Voice locale: {settings.voiceLocale}</DriverCopy>
            </>
          ) : (
            <DriverCopy>Navigation settings are not loaded yet.</DriverCopy>
          )}
          <DriverButton
            title="Open Full Settings"
            secondary
            disabled={!onSettings}
            onPress={() => {
              closeSheet();
              onSettings?.();
            }}
          />
        </DriverSheet>
      )}
      {active && sheet === 'route' && routes.route && (
        <DriverSheet title="Route Options" onClose={() => closeSheet()}>
          {feedback}
          <RoutePreview
            route={routes.route}
            metric={settings?.units === 'metric'}
          />
          {routes.plan && (
            <DriverCard>
              <DriverTitle small>Ordered stops</DriverTitle>
              {routes.plan.stops.map((stop, index) => (
                <View key={stop.id}>
                  <DriverCopy>
                    {index + 1}. {stop.name}
                  </DriverCopy>
                  <DriverButton
                    title={'Remove stop ' + (index + 1)}
                    secondary
                    disabled={pending}
                    onPress={() => {
                      void run(() =>
                        calculate(removeStop(routes.plan!, stop.id)),
                      );
                    }}
                  />
                  {index > 0 && (
                    <DriverButton
                      title={'Move stop ' + (index + 1) + ' earlier'}
                      secondary
                      disabled={pending}
                      onPress={() => {
                        void run(() =>
                          calculate(
                            reorderStop(routes.plan!, index, index - 1),
                          ),
                        );
                      }}
                    />
                  )}
                </View>
              ))}
              <DriverCopy>
                Final destination: {routes.plan.destination.name}
              </DriverCopy>
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
          <DriverButton
            title="POI Ahead"
            secondary
            onPress={() => setSheet('poiAhead')}
          />
          <DriverButton
            title="Weather 50 Miles Ahead"
            secondary
            onPress={() => driverAssistant('weather 50 miles ahead')}
          />
          <DriverButton
            title="Weather 100 Miles Ahead"
            secondary
            onPress={() => driverAssistant('weather 100 miles ahead')}
          />
          <DriverButton
            title="Cheapest Reported Diesel on Route"
            secondary
            onPress={() => driverAssistant('cheapest diesel on my route')}
          />
          <DriverButton
            title="Places Filter"
            secondary
            onPress={() => setSheet('placesFilter')}
          />
          <DriverButton
            title="Audio Settings"
            secondary
            onPress={() => setSheet('audio')}
          />
          <DriverButton
            title="Share Trip"
            secondary
            disabled={pending}
            onPress={() => {
              void run(shareTrip);
            }}
          />
          <DriverButton
            title="Report Road or Station"
            secondary
            disabled={!onServices}
            onPress={() => {
              closeSheet();
              onServices?.();
            }}
          />
          <DriverButton
            title={navigationStarting ? 'Cancel Route / Navigation' : 'Cancel Route'}
            secondary
            disabled={cancellingRoute}
            onPress={confirmCancelRoute}
          />
        </DriverSheet>
      )}
      {active &&
        sheet === 'arrival' &&
        navigation.phase === 'arrived' &&
        routes.route &&
        routes.plan && (
          <DriverSheet
            title="Trip Complete"
            onClose={() => setSheet('navigation')}
          >
            <ArrivalSummary
              route={routes.route}
              plan={routes.plan}
              metric={settings?.units === 'metric'}
              busy={cancellingRoute}
              onDone={() => {
                void finishArrivedRoute();
              }}
            />
          </DriverSheet>
        )}
      {active && sheet === 'navigation' && navigationSession && (
        <DriverSheet title="Navigation Controls" onClose={() => closeSheet()}>
          {feedback}
          <DriverCard>
            <View style={ds.row}>
              <DriverIcon name="route_rounded" color="#0B68E8" size={28} />
              <View style={ds.grow}>
                <DriverTitle small>
                  {navigation.phase === 'arrived'
                    ? 'Destination reached'
                    : navigation.phase === 'paused'
                    ? 'Navigation paused'
                    : navigation.phase === 'rerouting'
                    ? 'Truck-safe reroute in progress'
                    : 'Turn-by-turn navigation active'}
                </DriverTitle>
                <DriverCopy>
                  {navigationSummary || 'Waiting for live navigation progress…'}
                </DriverCopy>
              </View>
            </View>
          </DriverCard>
          {navigation.phase !== 'arrived' && (
            <DriverButton
              title={
                navigation.phase === 'paused'
                  ? 'Resume Navigation'
                  : navigation.phase === 'rerouting'
                  ? 'Rerouting…'
                  : 'Pause Navigation'
              }
              disabled={
                pending ||
                (navigation.phase !== 'paused' &&
                  navigation.phase !== 'navigating')
              }
              onPress={() => {
                void run(toggleNavigationPause);
              }}
            />
          )}
          {navigation.phase !== 'arrived' && (
            <DriverButton
              title="Continue Navigation"
              secondary
              onPress={() => closeSheet()}
            />
          )}
          {navigation.phase === 'arrived' && (
            <DriverButton
              title="Trip Complete Summary"
              onPress={() => setSheet('arrival')}
            />
          )}
          <DriverButton
            title="Route Overview"
            secondary
            onPress={() => {
              setOverviewRequest(value => value + 1);
              closeSheet();
            }}
          />
          <DriverButton
            title="Recenter / Follow Truck"
            secondary
            disabled={!location.fix}
            onPress={() => {
              setRecenterRequest(value => value + 1);
              closeSheet();
            }}
          />
          <DriverButton
            title="Weather 50 Miles Ahead"
            secondary
            onPress={() => driverAssistant('weather 50 miles ahead')}
          />
          <DriverButton
            title="Weather 100 Miles Ahead"
            secondary
            onPress={() => driverAssistant('weather 100 miles ahead')}
          />
          <DriverButton
            title="Cheapest Reported Diesel on Route"
            secondary
            onPress={() => driverAssistant('cheapest diesel on my route')}
          />
          <DriverButton
            title="POI Ahead"
            secondary
            onPress={() => setSheet('poiAhead')}
          />
          <DriverButton
            title="Search Places"
            secondary
            onPress={() => {
              setDetail(null);
              setSheet('search');
            }}
          />
          <DriverButton
            title="Places Filter"
            secondary
            onPress={() => setSheet('placesFilter')}
          />
          <DriverButton
            title="Route Options"
            secondary
            onPress={() => setSheet('route')}
          />
          <DriverButton
            title="Audio Settings"
            secondary
            onPress={() => setSheet('audio')}
          />
          <DriverButton
            title="Share Trip"
            secondary
            disabled={pending}
            onPress={() => {
              void run(shareTrip);
            }}
          />
          <DriverButton
            title="Report Road or Station"
            secondary
            disabled={!onServices}
            onPress={() => {
              closeSheet();
              onServices?.();
            }}
          />
          <DriverTitle small>Map options</DriverTitle>
          <DriverButton
            title={mapPrefs.satellite ? 'Use Street Map' : 'Use Satellite Map'}
            secondary
            disabled={pending || !settings}
            onPress={() => {
              void run(() =>
                saveMapPreferences({ satellite: !mapPrefs.satellite }),
              );
            }}
          />
          <DriverButton
            title={mapPrefs.autoZoom ? 'Turn Auto Zoom Off' : 'Turn Auto Zoom On'}
            secondary
            disabled={pending || !settings}
            onPress={() => {
              void run(() => saveMapPreferences({ autoZoom: !mapPrefs.autoZoom }));
            }}
          />
          <DriverButton
            title={
              mapPrefs.autoDayNight
                ? 'Turn Sunrise / Sunset Theme Off'
                : 'Turn Sunrise / Sunset Theme On'
            }
            secondary
            disabled={pending || !settings}
            onPress={() => {
              void run(() =>
                saveMapPreferences({ autoDayNight: !mapPrefs.autoDayNight }),
              );
            }}
          />
          <DriverButton
            title="End Navigation"
            secondary
            disabled={pending}
            onPress={confirmEndNavigation}
          />
          <DriverButton
            title="Cancel Route / Navigation"
            secondary
            disabled={cancellingRoute}
            onPress={confirmCancelRoute}
          />
          <DriverCopy>
            Closing this panel keeps navigation running. End Navigation stops
            guidance but keeps the route. Cancel Route clears the planned route.
          </DriverCopy>
        </DriverSheet>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
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
