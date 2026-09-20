import {
  DocumentAttachmentEditor,
  DocumentPendingUploads,
  SavedDocumentFiles,
} from '../features/documents/DocumentAttachments';
import { MAX_INTERMEDIATE_STOPS } from '../models/routeLimits';
import NativePlatform from '../native/navigation/NativeSemiTraxPlatform';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { DriverSheet } from '../components/DriverSheet';
import { DriverIcon } from '../components/DriverIcon';
import {
  TripAction,
  TripFilters,
  TripIllustration,
  TripQuickActions,
  TripStatus,
  TripTruck,
  ts,
} from '../components/TripsPresentation';
import {
  DocumentCategories,
  DocumentDateField,
  DocumentRow,
  documentCategory,
  documentDay,
  documentExpiry,
  ds,
} from '../components/DocumentsPresentation';
import { z } from 'zod';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverField,
  DriverTitle,
  useDriverPalette,
} from '../components/DriverUI';
import { ErrorText, errorMessage } from '../components/ui';
import {
  addStop,
  createStopPlan,
  validateStopPlan,
} from '../features/stops/StopPlan';
import { coordinateSchema } from '../models/contracts';
import {
  pendingDocumentCreates,
  type PendingDocumentBody,
} from '../services/storage/PendingDocumentCreates';

const point = coordinateSchema.extend({
  id: z.string().min(1),
  name: z.string().min(1),
});
export const savedTripSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  revision: z.number().int().positive(),
  origin: point,
  destination: point,
  stops: z.array(point).max(MAX_INTERMEDIATE_STOPS),
  assigned: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedStopIds: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  // Optional display metadata never substitutes for the current verified truck.
  truckSnapshot: z
    .object({
      name: z.string().optional(),
      heightFt: z.number().finite().positive().optional(),
      weightLbs: z.number().finite().positive().optional(),
      axleCount: z.number().int().positive().optional(),
    })
    .nullable()
    .optional()
    .catch(undefined),
});
type SavedTrip = z.infer<typeof savedTripSchema>;
export function planFromTrip(value: unknown) {
  const trip = savedTripSchema.parse(value);
  const businessStops = trip.assigned
    ? [trip.origin, ...trip.stops]
    : trip.stops;
  if (
    new Set([...businessStops, trip.destination].map(stop => stop.id)).size !==
    businessStops.length + 1
  )
    throw new Error('Trip stops have duplicate identities. Refresh the trip.');
  if (
    trip.completedStopIds.length > businessStops.length ||
    trip.completedStopIds.some((id, i) => id !== businessStops[i]?.id)
  )
    throw new Error(
      'Trip stop progress could not be validated. Refresh the trip.',
    );
  const remaining = businessStops.slice(trip.completedStopIds.length);
  const raw = { destination: trip.destination, stops: remaining };
  validateStopPlan(raw);
  return remaining.reduce(
    (plan, stop) => addStop(plan, stop),
    createStopPlan(trip.destination),
  );
}
function nextTripStop(trip: SavedTrip) {
  try {
    return planFromTrip(trip).stops[0];
  } catch {
    return undefined;
  }
}
// Screen-scoped requests never update an unmounted screen or a replacement account.
function useLibraryRequest(services: Services) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const locked = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (live.current) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }, []);
  const account = useCallback(
    () => services.auth.getSnapshot().user?.id,
    [services],
  );
  const valid = useCallback(
    (id: string | undefined) => live.current && !!id && account() === id,
    [account],
  );
  return { busy, error, run, account, valid };
}
export function TripsScreen({
  services,
  onMap,
}: {
  services: Services;
  onMap: () => void;
}) {
  const [items, setItems] = useState<SavedTrip[]>([]),
    [review, setReview] = useState<{
      trip: SavedTrip;
      status: string;
      completedStopId?: string;
    } | null>(null),
    [notice, setNotice] = useState('');
  const p = useDriverPalette();
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'Recent' | 'Saved' | 'Planned'>(
    'Recent',
  );
  const [opened, setOpened] = useState<{
    id: string;
    mode: 'details' | 'actions';
  } | null>(null);
  const trucks = useStore(services.trucks);
  const routes = useStore(services.routes),
    request = useLibraryRequest(services);
  const { account: getAccount, valid: isCurrent, run } = request;
  const [planSaved, setPlanSaved] = useState(false);
  const pendingPlan = useRef<Record<string, unknown> | undefined>(undefined);
  const saveAttempted = useRef(false),
    createOperation = useRef<string | undefined>(undefined);
  const load = useCallback(async () => {
    const account = getAccount();
    if (!account) return;
    setRefreshing(true);
    try {
      const data = await services.api.request('GET', '/trips');
      const rows = z
        .object({ items: z.array(savedTripSchema) })
        .parse(data).items;
      if (isCurrent(account)) {
        setItems(rows);
        setLoaded(true);
      }
    } finally {
      if (isCurrent(account)) setRefreshing(false);
    }
  }, [services, getAccount, isCurrent]);
  useEffect(() => {
    void run(async () => {
      await load();
    });
  }, [load, run, routes.route]); // Automatic reads only; never writes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active')
        void run(async () => {
          await load();
        });
    });
    return () => subscription.remove();
  }, [load, run]);
  async function savePlan() {
    if (saveAttempted.current) return;
    const account = getAccount(),
      state = services.routes.getSnapshot(),
      truck = services.trucks.getSnapshot().selected,
      fix = services.location.getFreshFix();
    if (
      !state.plan ||
      !state.route?.truckSafe ||
      !state.route.navigationAllowed ||
      !truck ||
      !fix
    )
      throw new Error('A reviewed route and fresh location are required.');
    if (!NativePlatform)
      throw new Error('Native operation identifier unavailable.');
    createOperation.current ??= await NativePlatform.createOperationId();
    saveAttempted.current = true;
    pendingPlan.current = {
      createOperationId: createOperation.current,
      name: state.plan.destination.name,
      origin: {
        id: 'origin',
        name: 'Planned origin',
        lat: fix.latitude,
        lng: fix.longitude,
      },
      destination: state.plan.destination,
      stops: state.plan.stops,
      truckId: truck.id,
      expectedTruckRevision: truck.revision,
    };
    await sendPlan(account);
  }
  async function sendPlan(account = getAccount()) {
    if (!pendingPlan.current) return;
    await services.api.request('POST', '/trips', pendingPlan.current);
    pendingPlan.current = undefined;
    setPlanSaved(true);
    if (isCurrent(account)) {
      setNotice(
        'Plan saved. Trip progress is driver-reported; this does not start navigation.',
      );
      await load();
    }
  }
  async function transition() {
    if (!review) return;
    const account = getAccount(),
      shown = review;
    try {
      await services.api.request(
        'PATCH',
        '/trips/' + encodeURIComponent(shown.trip.id) + '/status',
        {
          expectedRevision: shown.trip.revision,
          status: shown.status,
          ...(shown.completedStopId
            ? { completedStopId: shown.completedStopId }
            : {}),
        },
      );
    } finally {
      if (isCurrent(account)) {
        // A completed/ambiguous stop write makes the previously calculated plan stale.
        // Recalculation remains an explicit driver action using refreshed server progress.
        if (shown.completedStopId) services.routes.clear();
        setReview(null);
        await load();
      }
    }
  }
  async function calculate(trip: SavedTrip) {
    const account = getAccount();
    const data = z
      .object({ items: z.array(savedTripSchema) })
      .parse(await services.api.request('GET', '/trips'));
    if (!isCurrent(account)) return;
    setItems(data.items);
    const current = data.items.find(row => row.id === trip.id);
    if (
      !current ||
      ['ASSIGNED', 'CANCELLED', 'COMPLETED'].includes(current.status)
    )
      throw new Error('Refresh and review this trip before routing.');
    const truck = services.trucks.getSnapshot().selected,
      fix = services.location.getFreshFix();
    if (!truck || !fix)
      throw new Error(
        'Review your verified truck profile and acquire fresh GPS first.',
      );
    if (
      await services.routes.calculate(
        { lat: fix.latitude, lng: fix.longitude },
        planFromTrip(current),
        truck,
      )
    ) {
      setOpened(null);
      onMap();
    }
  }
  const actions: Record<string, string[]> = {
    ASSIGNED: ['PLANNED', 'CANCELLED'],
    PLANNED: ['STARTED', 'CANCELLED'],
    STARTED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  };
  const labels: Record<string, string> = {
    PLANNED: 'Accept assignment',
    STARTED: 'Record trip started',
    IN_PROGRESS: 'Record trip in progress',
    COMPLETED: 'Record trip completed',
    CANCELLED: 'Cancel / reject trip',
  };
  const shown =
    filter === 'Planned'
      ? items.filter(trip => ['PLANNED', 'ASSIGNED'].includes(trip.status))
      : filter === 'Saved'
      ? // Saved is a view of persisted driver-created plans, not a new API status.
        items.filter(trip => trip.status === 'PLANNED' && !trip.assigned)
      : items;
  const trip = items.find(item => item.id === opened?.id);
  const canSave = !!(
    routes.plan &&
    routes.route?.truckSafe &&
    routes.route.navigationAllowed &&
    trucks.selected &&
    services.location.getFreshFix()
  );
  return (
    <ScrollView
      style={{ backgroundColor: p.canvas }}
      contentContainerStyle={ts.page}
      refreshControl={
        <RefreshControl
          refreshing={loaded && refreshing}
          onRefresh={() => {
            void run(async () => {
              await load();
            });
          }}
          tintColor={p.muted}
          colors={['#A63D0B']}
        />
      }
    >
      <View style={ts.section}>
        <DriverTitle>Trips</DriverTitle>
        <DriverCopy>Your routes, plans and trip history</DriverCopy>
      </View>
      <TripFilters value={filter} onChange={setFilter} />
      {canSave && !saveAttempted.current && (
        <TripAction
          title="Save current route"
          icon="bookmark_border_rounded"
          disabled={request.busy}
          onPress={() => {
            void run(savePlan);
          }}
        />
      )}
      {pendingPlan.current && (
        <View style={ts.section}>
          <DriverCopy>
            Save result unconfirmed. Retry keeps the same plan and operation.
          </DriverCopy>
          <TripAction
            title="Retry same trip save"
            disabled={request.busy}
            onPress={() => {
              void run(() => sendPlan());
            }}
          />
        </View>
      )}
      {planSaved && (
        <TripAction
          title="Prepare a different trip plan"
          disabled={request.busy}
          onPress={() => {
            saveAttempted.current = false;
            createOperation.current = undefined;
            setPlanSaved(false);
            setNotice('');
          }}
        />
      )}
      {!!notice && <DriverCopy>{notice}</DriverCopy>}
      {!!request.error && (
        <DriverCard>
          <DriverCopy>
            {loaded
              ? 'Showing last loaded trips. Changes and routing require a connection.'
              : "Trips couldn't be loaded."}
          </DriverCopy>
          <ErrorText message={request.error} />
          <TripAction
            title="Retry trips"
            icon="replay"
            disabled={request.busy}
            onPress={() => {
              void run(async () => {
                await load();
              });
            }}
          />
        </DriverCard>
      )}
      {!loaded && !request.error && (
        <View style={ts.empty} accessibilityLiveRegion="polite">
          <ActivityIndicator color={p.muted} />
          <DriverCopy>Loading trips…</DriverCopy>
        </View>
      )}
      {loaded && !shown.length && (
        <DriverCard>
          <TripIllustration />
          <View style={ts.empty}>
            <DriverTitle small>No trips yet</DriverTitle>
            <Text style={[ts.centered, { color: p.muted }]}>
              Your saved and planned trips will appear here.
            </Text>
          </View>
          <DriverButton title="Plan a truck route" onPress={onMap} />
        </DriverCard>
      )}
      {shown.map(item => {
        const rawDate = item.updatedAt ?? item.createdAt;
        const date = rawDate ? new Date(rawDate) : undefined;
        const validDate =
          date && Number.isFinite(date.getTime())
            ? date.toLocaleDateString()
            : undefined;
        return (
          <DriverCard key={item.id}>
            <View style={ts.cardTop}>
              <DriverIcon
                name="route_rounded"
                color={p.dark ? '#66DEC3' : '#007B65'}
                size={28}
              />
              <View style={ts.flex}>
                <Text style={[ts.title, { color: p.text }]}>
                  {item.origin.name} → {item.destination.name}
                </Text>
              </View>
            </View>
            <View style={ts.actions}>
              <TripStatus status={item.status} />
            </View>
            {(validDate || item.stops.length > 0) && (
              <DriverCopy>
                {[
                  validDate
                    ? (item.updatedAt ? 'Updated ' : 'Saved ') + validDate
                    : null,
                  item.stops.length
                    ? item.stops.length + ' intermediate stops'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </DriverCopy>
            )}
            <TripTruck truck={item.truckSnapshot} />
            {['STARTED', 'IN_PROGRESS', 'COMPLETED'].includes(item.status) && (
              <DriverCopy>
                Stored trip record · no verified navigation history.
              </DriverCopy>
            )}
            <View style={ts.actions}>
              <TripAction
                title={'View trip: ' + item.name}
                label="View trip"
                icon="chevron_right_rounded"
                onPress={() => setOpened({ id: item.id, mode: 'details' })}
              />
              <TripAction
                title={'More: ' + item.name}
                label="More"
                icon="more_horiz_rounded"
                onPress={() => setOpened({ id: item.id, mode: 'actions' })}
              />
            </View>
          </DriverCard>
        );
      })}
      {loaded && shown.length > 0 && (
        <DriverButton title="Plan a truck route" onPress={onMap} />
      )}
      {loaded && (
        <TripQuickActions onPlan={onMap} onSaved={() => setFilter('Saved')} />
      )}
      {trip && opened && (
        <DriverSheet
          title={opened.mode === 'details' ? 'Trip details' : 'Trip actions'}
          onClose={() => setOpened(null)}
        >
          <DriverTitle small>{trip.name}</DriverTitle>
          <TripStatus status={trip.status} />
          <DriverCopy>
            {trip.origin.name} →{' '}
            {[...trip.stops, trip.destination]
              .map(stop => stop.name)
              .join(' → ')}
          </DriverCopy>
          <TripTruck truck={trip.truckSnapshot} />
          <DriverCopy>
            Stored plan · revision {trip.revision}. Progress is driver-reported,
            not verified navigation.
          </DriverCopy>
          <ErrorText message={request.error} />
          {opened.mode === 'details' ? (
            <>
              {!['ASSIGNED', 'CANCELLED', 'COMPLETED'].includes(
                trip.status,
              ) && (
                <>
                  <DriverCopy>
                    Calculate a fresh truck-safe route from your current GPS
                    location using your current verified truck.
                  </DriverCopy>
                  <DriverButton
                    title="Calculate with current verified truck"
                    disabled={request.busy}
                    onPress={() => {
                      void run(async () => {
                        await calculate(trip);
                      });
                    }}
                  />
                </>
              )}
              <TripAction
                title="More trip actions"
                onPress={() => setOpened({ id: trip.id, mode: 'actions' })}
              />
            </>
          ) : (
            <>
              {trip.status === 'PLANNED' && (
                <DriverButton
                  secondary
                  title="Use current verified truck for this trip"
                  disabled={request.busy}
                  onPress={() => {
                    void run(async () => {
                      const truck = services.trucks.getSnapshot().selected;
                      if (!truck) throw new Error('Verify a truck first.');
                      try {
                        await services.api.request(
                          'PATCH',
                          '/trips/' + encodeURIComponent(trip.id) + '/truck',
                          {
                            expectedRevision: trip.revision,
                            truckId: truck.id,
                            expectedTruckRevision: truck.revision,
                          },
                        );
                      } finally {
                        await load();
                      }
                    });
                  }}
                />
              )}
              {(actions[trip.status] ?? []).map(status => (
                <DriverButton
                  secondary
                  key={status}
                  title={labels[status] ?? status}
                  disabled={request.busy}
                  onPress={() => {
                    setOpened(null);
                    setReview({ trip, status });
                  }}
                />
              ))}
              {['STARTED', 'IN_PROGRESS'].includes(trip.status) &&
                nextTripStop(trip) && (
                  <DriverButton
                    secondary
                    title="Record next stop completed"
                    disabled={request.busy}
                    onPress={() => {
                      setOpened(null);
                      setReview({
                        trip,
                        status: 'IN_PROGRESS',
                        completedStopId: nextTripStop(trip)?.id,
                      });
                    }}
                  />
                )}
              {!(actions[trip.status] ?? []).length && (
                <DriverCopy>
                  No further updates are available for this trip.
                </DriverCopy>
              )}
            </>
          )}
        </DriverSheet>
      )}
      {review && (
        <DriverSheet
          title="Confirm trip update"
          onClose={() => {
            if (!request.busy) setReview(null);
          }}
        >
          <DriverCopy>
            {review.trip.name}:{' '}
            {review.completedStopId
              ? 'Record completion of ' + nextTripStop(review.trip)?.name
              : labels[review.status]}
            . Confirm only what actually occurred. No navigation is started.
          </DriverCopy>
          <DriverButton
            title="Confirm trip update"
            disabled={request.busy}
            onPress={() => {
              void run(transition);
            }}
          />
          <DriverButton
            title="Keep current status"
            disabled={request.busy}
            onPress={() => setReview(null)}
          />
        </DriverSheet>
      )}
    </ScrollView>
  );
}

const docSchema = z.object({
  id: z.string(),
  type: z.string(),
  fileName: z.string(),
  revision: z.number().int().positive(),
  truckId: z.string().nullable(),
  issuedOn: z.string().nullable(),
  expiresOn: z.string().nullable(),
  verificationState: z.string(),
  expired: z.boolean(),
  fileAvailable: z.boolean(),
  attachmentCount: z.number().int().nonnegative().optional(),
});
export function DocumentsScreen({ services }: { services: Services }) {
  const [hasFiles, setHasFiles] = useState(false);
  const p = useDriverPalette();
  const [formOpen, setFormOpen] = useState(false);
  const [changingType, setChangingType] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [notice, setNotice] = useState('');
  const request = useLibraryRequest(services),
    [items, setItems] = useState<z.infer<typeof docSchema>[]>([]),
    [type, setType] = useState<string>('CDL'),
    [name, setName] = useState(''),
    [issued, setIssued] = useState(''),
    [expires, setExpires] = useState(''),
    [editing, setEditing] = useState<z.infer<typeof docSchema> | null>(null),
    [conflict, setConflict] = useState(false),
    [abandon, setAbandon] = useState(false),
    [ready, setReady] = useState(false);
  const { account: getAccount, valid: isCurrent, run } = request;
  const pendingDocument = useRef<
    { owner: string; method: string; path: string; body: unknown } | undefined
  >(undefined);
  const submitted = useRef(false),
    createOperation = useRef<string | undefined>(undefined);
  function resetForm() {
    setFormOpen(false);
    setChangingType(false);
    setHasFiles(false);
    setType('CDL');
    setName('');
    setIssued('');
    setExpires('');
    setEditing(null);
    setConflict(false);
    setAbandon(false);
    submitted.current = false;
    pendingDocument.current = undefined;
    createOperation.current = undefined;
  }
  const restorePending = useCallback(
    (body: PendingDocumentBody, owner: string) => {
      createOperation.current = body.createOperationId;
      pendingDocument.current = {
        owner,
        method: 'POST',
        path: '/documents',
        body,
      };
      submitted.current = true;
      setFormOpen(true);
      setEditing(null);
      setConflict(false);
      setType(body.type);
      setName(body.fileName);
      setIssued(body.issuedOn ?? '');
      setExpires(body.expiresOn ?? '');
    },
    [],
  );
  const load = useCallback(async () => {
    const account = getAccount();
    setRefreshing(true);
    try {
      const data = z
        .object({ items: z.array(docSchema) })
        .parse(await services.api.request('GET', '/documents'));
      if (isCurrent(account)) {
        setItems(data.items);
        setLoaded(true);
        setToday(new Date());
      }
      return data.items;
    } finally {
      if (isCurrent(account)) setRefreshing(false);
    }
  }, [services, getAccount, isCurrent]);
  const initialize = useCallback(async () => {
    const owner = getAccount();
    if (!owner) return;
    const pending = await pendingDocumentCreates.read(owner);
    if (!isCurrent(owner)) return;
    if (pending) restorePending(pending, owner);
    setReady(true);
    await load();
  }, [getAccount, isCurrent, load, restorePending]);
  useEffect(() => {
    void run(initialize);
  }, [initialize, run]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setToday(new Date());
        void run(async () => {
          await load();
        });
      }
    });
    const timer = setInterval(() => setToday(new Date()), 60000);
    return () => {
      listener.remove();
      clearInterval(timer);
    };
  }, [load, run]);
  async function save() {
    if (!ready || submitted.current || conflict) return;
    if (dateError) throw new Error(dateError);
    const account = getAccount();
    if (!account || !isCurrent(account)) return;
    if (!NativePlatform)
      throw new Error('Native operation identifier unavailable.');
    createOperation.current ??= await NativePlatform.createOperationId();
    const metadata = {
      createOperationId: createOperation.current,
      type,
      fileName: name,
      issuedOn: issued || null,
      expiresOn: expires || null,
      truckId: editing?.truckId ?? null,
    };
    if (!account || !isCurrent(account)) return;
    if (!editing) {
      const stored = await pendingDocumentCreates.begin(account, metadata);
      if (!isCurrent(account)) return;
      restorePending(stored, account);
      if (JSON.stringify(stored) !== JSON.stringify(metadata))
        throw new Error(
          'An earlier document save needs review. Retry the recovered operation.',
        );
      await sendDocument(account);
      return;
    }
    submitted.current = true;
    pendingDocument.current = {
      owner: account,
      method: editing ? 'PATCH' : 'POST',
      path:
        '/documents' + (editing ? '/' + encodeURIComponent(editing.id) : ''),
      body: editing
        ? { expectedRevision: editing.revision, metadata }
        : metadata,
    };
    await sendDocument(account);
  }
  async function sendDocument(account = getAccount()) {
    const pending = pendingDocument.current;
    if (
      !pending ||
      !account ||
      pending.owner !== account ||
      !isCurrent(account)
    )
      return;
    try {
      await services.api.request(pending.method, pending.path, pending.body);
      if (pending.method === 'POST')
        await pendingDocumentCreates.complete(
          account,
          (pending.body as PendingDocumentBody).createOperationId,
        );
      if (isCurrent(account)) {
        resetForm();
        setNotice('Document record saved.');
        await load();
      }
    } catch (e) {
      if (
        pending.method === 'PATCH' &&
        isCurrent(account) &&
        (e as { status?: number }).status === 409
      ) {
        submitted.current = false;
        pendingDocument.current = undefined;
        createOperation.current = undefined;
        setConflict(true);
        const rows = await load();
        if (isCurrent(account))
          setEditing(rows.find(d => d.id === editing?.id) ?? editing);
      } else if (
        pending.method === 'PATCH' &&
        isCurrent(account) &&
        (e as { status?: number }).status &&
        (e as { status: number }).status < 500
      ) {
        submitted.current = false;
        pendingDocument.current = undefined;
      }
      throw e;
    }
  }

  const dateError =
    (issued && documentDay(issued) === undefined) ||
    (expires && documentDay(expires) === undefined)
      ? 'Choose a valid document date.'
      : issued && expires && issued > expires
      ? 'Expiration date must be on or after the issue date.'
      : undefined;
  const blocked = !ready || request.busy || submitted.current;
  function addDocument(category: string) {
    if (blocked) return;
    resetForm();
    setType(category);
    setName(documentCategory(category).defaultLabel);
    setNotice('');
    setFormOpen(true);
  }
  function editDocument(record: z.infer<typeof docSchema>) {
    if (blocked) return;
    resetForm();
    setEditing(record);
    setType(record.type);
    setName(record.fileName);
    setIssued(record.issuedOn?.slice(0, 10) ?? '');
    setExpires(record.expiresOn?.slice(0, 10) ?? '');
    setFormOpen(true);
  }
  const expiring = items
    .filter(record => documentExpiry(record.expiresOn, today).soon)
    .sort((a, b) => documentDay(a.expiresOn)! - documentDay(b.expiresOn)!);
  const row = (record: z.infer<typeof docSchema>) => (
    <DocumentRow
      key={record.id}
      document={record}
      now={today}
      disabled={blocked}
      onPress={() => editDocument(record)}
    />
  );
  return (
    <ScrollView
      style={{ backgroundColor: p.canvas }}
      contentContainerStyle={ds.page}
      refreshControl={
        <RefreshControl
          refreshing={loaded && refreshing}
          onRefresh={() => {
            void run(async () => {
              await (ready ? load() : initialize());
            });
          }}
          tintColor={p.muted}
          colors={['#A63D0B']}
        />
      }
    >
      <View style={ds.section}>
        <DriverTitle>Documents</DriverTitle>
        <DriverCopy>
          Keep your driver, truck and trip records organized.
        </DriverCopy>
      </View>
      <DocumentPendingUploads
        services={services}
        onChanged={() => {
          void run(async () => {
            await load();
          });
        }}
      />
      {!!notice && <DriverCopy>{notice}</DriverCopy>}
      {!!request.error && !formOpen && (
        <DriverCard>
          <DriverCopy>
            {loaded
              ? 'Showing last loaded documents.'
              : "Documents couldn't be loaded."}
          </DriverCopy>
          <ErrorText message={request.error} />
          <TripAction
            title="Retry documents"
            icon="replay"
            disabled={request.busy}
            onPress={() => {
              void run(async () => {
                await (ready ? load() : initialize());
              });
            }}
          />
        </DriverCard>
      )}
      {submitted.current && !formOpen && (
        <TripAction
          title="Continue document save"
          onPress={() => setFormOpen(true)}
        />
      )}
      {!submitted.current && !!name && !formOpen && (
        <TripAction
          title="Continue editing document"
          onPress={() => setFormOpen(true)}
        />
      )}
      <DriverCard>
        <DriverTitle small>My Documents</DriverTitle>
        <DriverCopy>
          Your saved document records and expiration dates.
        </DriverCopy>
        {!loaded && !request.error && (
          <View style={ds.header}>
            <ActivityIndicator color={p.muted} />
            <DriverCopy>Loading documents…</DriverCopy>
          </View>
        )}
        {loaded && !items.length && (
          <DriverCopy>
            No documents yet. Choose a category below to add one.
          </DriverCopy>
        )}
        {items.map(row)}
      </DriverCard>
      <DriverCard>
        <DriverTitle small>Add Document</DriverTitle>
        <DriverCopy>Select a document type to add.</DriverCopy>
        <DocumentCategories disabled={blocked} onSelect={addDocument} />
      </DriverCard>
      <DriverCard>
        <DriverTitle small>Expiring Soon</DriverTitle>
        <DriverCopy>
          Dates you saved that expire in the next 90 days. This is not document
          verification.
        </DriverCopy>
        {expiring.map(row)}
        {loaded && !expiring.length && (
          <DriverCopy>
            No saved expiration dates in the next 90 days.
          </DriverCopy>
        )}
      </DriverCard>
      <DriverCopy>
        Store document records and private attachments. Uploads require
        configured private storage. Dates are your records, not verification.
      </DriverCopy>
      {formOpen && (
        <DriverSheet
          title={(editing ? 'Edit ' : 'Add ') + documentCategory(type).label}
          onClose={() => {
            if (!request.busy) setFormOpen(false);
          }}
        >
          <DriverCopy>
            Take a photo or upload a document. Files are saved on this device
            first; secure server storage is confirmed only after upload.
          </DriverCopy>
          <ErrorText message={request.error} />
          {conflict && (
            <DriverCard>
              <DriverCopy>
                The document changed. Your unsaved fields are preserved. Review
                the latest server record before intentionally merging your
                edits. No save was retried.
              </DriverCopy>
              <DriverCopy>
                Latest revision {editing?.revision}: {editing?.fileName},{' '}
                {editing?.type}, issued {editing?.issuedOn ?? 'not recorded'},
                expires {editing?.expiresOn ?? 'not recorded'}.
              </DriverCopy>
              <DriverButton
                title="Review latest and keep my edits"
                disabled={request.busy}
                onPress={() => {
                  void run(async () => {
                    const owner = getAccount();
                    const rows = await load();
                    if (!isCurrent(owner)) return;
                    const latest = rows.find(d => d.id === editing?.id);
                    if (!latest)
                      throw new Error(
                        'This document is no longer available. Cancel editing to create a different document.',
                      );
                    if (latest.revision !== editing?.revision) {
                      setEditing(latest);
                      return;
                    }
                    setEditing(latest);
                    setConflict(false);
                  });
                }}
              />
            </DriverCard>
          )}
          {(editing || conflict) && (
            <DriverButton
              title="Cancel editing"
              disabled={request.busy || submitted.current}
              onPress={resetForm}
            />
          )}

          <TripAction
            title="Change document type"
            disabled={request.busy || submitted.current}
            onPress={() => setChangingType(!changingType)}
          />
          {changingType && (
            <DocumentCategories
              disabled={request.busy || submitted.current}
              onSelect={category => {
                setType(category);
                setChangingType(false);
              }}
            />
          )}
          <DriverField
            editable={!request.busy && !submitted.current}
            label="Document label"
            value={name}
            onChangeText={setName}
            maxLength={150}
          />
          <DocumentDateField
            label="Issue date"
            value={issued}
            onChange={setIssued}
            disabled={request.busy || submitted.current}
          />
          <DocumentDateField
            label="Expiration date"
            value={expires}
            onChange={setExpires}
            disabled={request.busy || submitted.current}
          />
          <DocumentAttachmentEditor
            services={services}
            body={{
              type,
              fileName: name,
              issuedOn: issued || null,
              expiresOn: expires || null,
              truckId: editing?.truckId ?? null,
            }}
            documentId={editing?.id}
            disabled={request.busy || !!dateError || conflict}
            onHasFiles={setHasFiles}
            onChanged={() => {
              void run(async () => {
                await load();
              });
            }}
          />
          {editing && (
            <SavedDocumentFiles
              services={services}
              documentId={editing.id}
              onDeleted={() => {
                resetForm();
                void run(async () => {
                  await load();
                });
              }}
            />
          )}
          <ErrorText message={dateError} />
          <DriverButton
            title={
              hasFiles
                ? 'Use Save document and attachments above'
                : 'Save document'
            }
            disabled={
              hasFiles ||
              !ready ||
              request.busy ||
              !name.trim() ||
              submitted.current ||
              conflict ||
              !!dateError
            }
            onPress={() => {
              void run(save);
            }}
          />
          {pendingDocument.current && (
            <DriverButton
              title="Retry same document save"
              disabled={request.busy}
              onPress={() => {
                void run(() => sendDocument());
              }}
            />
          )}
          {submitted.current && (
            <DriverCopy>
              Save result unconfirmed. Retry sends the same operation and
              unchanged details.
            </DriverCopy>
          )}
          {pendingDocument.current?.method === 'POST' && (
            <DriverButton
              title="Abandon document recovery"
              disabled={request.busy}
              onPress={() => setAbandon(true)}
            />
          )}
          {abandon && (
            <DriverCard>
              <DriverCopy>
                The previous save may already exist. Refresh and check the list
                before starting a genuinely different document. Abandoning
                recovery does not delete any server record.
              </DriverCopy>
              <DriverButton
                title="Confirm abandon and start a different document"
                disabled={request.busy}
                onPress={() => {
                  void run(async () => {
                    const owner = getAccount(),
                      pending = pendingDocument.current;
                    if (!owner || pending?.method !== 'POST') return;
                    await load();
                    if (!isCurrent(owner)) return;
                    await pendingDocumentCreates.complete(
                      owner,
                      (pending.body as PendingDocumentBody).createOperationId,
                    );
                    if (isCurrent(owner)) resetForm();
                  });
                }}
              />
              <DriverButton
                title="Keep recovery operation"
                disabled={request.busy}
                onPress={() => setAbandon(false)}
              />
            </DriverCard>
          )}
        </DriverSheet>
      )}
    </ScrollView>
  );
}
