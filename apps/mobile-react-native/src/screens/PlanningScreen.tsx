import { DriverError } from '../errors/driverErrors';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
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
import { PoiArtwork, placeShortcuts } from '../features/poi/PoiPresentation';
import { TruckMap } from '../features/map/TruckMap';
import { RoutePreview, routeEstimate } from '../features/routing/RoutePreview';
export function PlanningScreen({
  services,
  onTrucks,
  onServices,
  active = true,
}: {
  services: Services;
  onTrucks?: () => void;
  onServices?: () => void;
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
  const [sheet, setSheet] = useState<'search' | 'route' | 'location' | null>(
    null,
  );
  const [detail, setDetail] = useState<Stop | null>(null);
  const searched = searchState.phase === 'ready';
  const [expanded, setExpanded] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(164);
  const [topHeight, setTopHeight] = useState(44);
  const busyRef = useRef(false);
  const palette = useDriverPalette();
  useEffect(() => {
    void services.trucks.load().catch(e => setError(errorMessage(e)));
    void services.settings.load().catch(e => setError(errorMessage(e)));
  }, [services]);
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
  async function calculate(plan: StopPlan, alternatives = 0) {
    const truck = services.trucks.getSnapshot().selected;
    if (!truck) {
      throw new DriverError('VERIFIED_TRUCK_REQUIRED');
    }
    const controller = new AbortController();
    gpsRequest.current = controller;
    setAcquiringGps(true);
    try {
      await services.location.requestFreshFix(controller.signal);
      if (controller.signal.aborted || AppState.currentState !== 'active') return;
      // A driver may edit/sign out while GPS is being acquired. Never send the old profile.
      const selected = services.trucks.getSnapshot().selected;
      if (!selected || selected !== truck) throw new DriverError('VERIFIED_TRUCK_REQUIRED');
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
  const night =
    settings?.dayNightMode === 'night' ||
    (settings?.dayNightMode !== 'day' && scheme === 'dark');

  function search() {
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
      void searchStore.nearby(category, origin());
    } catch (e) {
      setError(errorMessage(e));
    }
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
  const estimate = routes.route
    ? routeEstimate(routes.route, settings?.units === 'metric')
    : null;
  const feedback = (
    <>
      <ErrorText message={error ?? searchState.error ?? routes.error} />
      {pending && (
        <View style={ds.row}>
          <ActivityIndicator color="#FF6B2C" />
          <DriverCopy>{acquiringGps ? 'Acquiring a fresh precise GPS fix…' : 'Requesting authoritative truck data…'}</DriverCopy>
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
          pois={pois}
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
          expanded ? styles.expandedBottom : styles.collapsedBottom,
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
              accessibilityLabel="Review route and stops"
              onPress={() => setSheet('route')}
              style={ds.row}
            >
              <DriverIcon name="route_rounded" color="#0B68E8" size={26} />
              <View style={ds.grow}>
                <Text style={[styles.routeTitle, { color: palette.text }]}>
                  Truck route ready
                </Text>
                <DriverCopy>
                  {estimate?.distance} · {estimate?.duration} · Trimble estimate
                </DriverCopy>
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
          {expanded ? (
            <>
              {routes.route && (
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
          {categories(true)}
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
                    <DriverCopy>
                      {poi.address || 'Address not supplied'}
                    </DriverCopy>
                    <DriverCopy>Truck entrance unverified</DriverCopy>
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
                onPress={() => { void run(() => calculate(routes.plan!, 2)); }}
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
            title="Start navigation — unavailable"
            disabled
            onPress={() => {}}
          />
          <DriverCopy>
            Live maneuvers, lane guidance, voice and arrival require verified
            CoPilot runtime data. This screen is a route preview.
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
