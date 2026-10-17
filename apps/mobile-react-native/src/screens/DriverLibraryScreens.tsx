import NativePlatform from '../native/navigation/NativeSemiTraxPlatform';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { z } from 'zod';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverField,
  DriverPage,
  DriverTitle,
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
  stops: z.array(point).max(20),
  assigned: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedStopIds: z.array(z.string()).default([]),
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
  const routes = useStore(services.routes),
    request = useLibraryRequest(services);
  const { account: getAccount, valid: isCurrent, run } = request;
  const [planSaved, setPlanSaved] = useState(false);
  const pendingPlan = useRef<Record<string, unknown> | undefined>(undefined);
  const saveAttempted = useRef(false),
    createOperation = useRef<string | undefined>(undefined);
  const load = useCallback(async () => {
    const account = getAccount();
    const data = await services.api.request('GET', '/trips');
    const rows = z
      .object({ items: z.array(savedTripSchema) })
      .parse(data).items;
    if (isCurrent(account)) setItems(rows);
  }, [services, getAccount, isCurrent]);
  useEffect(() => {
    void run(load);
  }, [load, run]); // Only refresh/read on entry; no automatic writes.
  async function savePlan() {
    if (saveAttempted.current) return;
    const account = getAccount(),
      state = services.routes.getSnapshot(),
      truck = services.trucks.getSnapshot().selected,
      fix = services.location.getFreshFix();
    if (!state.plan || !state.route || !truck || !fix)
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
    )
      onMap();
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
  return (
    <DriverPage>
      <DriverTitle>Trips</DriverTitle>
      <DriverCopy>
        Saved plans and driver-reported history. Progress does not certify
        navigation, mileage or arrival.
      </DriverCopy>
      <DriverButton
        title="Refresh trips"
        disabled={request.busy}
        onPress={() => {
          void run(load);
        }}
      />
      <DriverButton
        title="Save current route as trip plan"
        disabled={request.busy || !routes.route || saveAttempted.current}
        onPress={() => {
          void run(savePlan);
        }}
      />
      {saveAttempted.current && (
        <DriverCopy>
          {planSaved
            ? 'Plan saved.'
            : 'Save result unconfirmed. Retry uses the same operation and unchanged values.'}
        </DriverCopy>
      )}
      {pendingPlan.current && (
        <DriverButton
          title="Retry same trip save"
          disabled={request.busy}
          onPress={() => {
            void run(() => sendPlan());
          }}
        />
      )}
      {planSaved && (
        <DriverButton
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
      <ErrorText message={request.error} />
      <DriverCopy>{notice}</DriverCopy>
      {!items.length && <DriverCopy>No saved trips returned.</DriverCopy>}
      {items.map(trip => (
        <DriverCard key={trip.id}>
          <DriverTitle small>{trip.name}</DriverTitle>
          <DriverCopy>
            {trip.status.replace(/_/g, ' ')} · Revision {trip.revision}
          </DriverCopy>
          <DriverCopy>
            {trip.origin.name} →{' '}
            {[...trip.stops, trip.destination].map(p => p.name).join(' → ')}
          </DriverCopy>
          {!['ASSIGNED', 'CANCELLED', 'COMPLETED'].includes(trip.status) && (
            <DriverButton
              title="Calculate with current verified truck"
              disabled={request.busy}
              onPress={() => {
                void run(() => calculate(trip));
              }}
            />
          )}
          {trip.status === 'PLANNED' && (
            <DriverButton
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
              key={status}
              title={labels[status] ?? status}
              disabled={request.busy}
              onPress={() => setReview({ trip, status })}
            />
          ))}
          {['STARTED', 'IN_PROGRESS'].includes(trip.status) &&
            nextTripStop(trip) && (
              <DriverButton
                title="Record next stop completed"
                disabled={request.busy}
                onPress={() =>
                  setReview({
                    trip,
                    status: 'IN_PROGRESS',
                    completedStopId: nextTripStop(trip)?.id,
                  })
                }
              />
            )}
        </DriverCard>
      ))}
      {review && (
        <DriverCard>
          <DriverTitle small>Confirm trip update</DriverTitle>
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
        </DriverCard>
      )}
      <DriverButton title="Plan truck route" onPress={onMap} />
    </DriverPage>
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
  fileAvailable: z.literal(false),
});
const documentTypes = [
  'CDL',
  'MEDICAL',
  'REGISTRATION',
  'INSURANCE',
  'PERMIT',
  'IFTA',
  'BOL',
  'POD',
  'RATE_CONFIRMATION',
  'GENERAL',
] as const;
export function DocumentsScreen({ services }: { services: Services }) {
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
    const data = z
      .object({ items: z.array(docSchema) })
      .parse(await services.api.request('GET', '/documents'));
    if (isCurrent(account)) setItems(data.items);
    return data.items;
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
  async function save() {
    if (!ready || submitted.current || conflict) return;
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
  return (
    <DriverPage>
      <DriverTitle>Documents</DriverTitle>
      <DriverCopy>
        Private metadata records only. File upload/download and document
        verification are unavailable; do not enter document numbers or contents.
      </DriverCopy>
      <ErrorText message={request.error} />
      <DriverButton
        title="Refresh documents"
        disabled={request.busy}
        onPress={() => {
          void run(initialize);
        }}
      />
      {items.map(d => (
        <DriverCard key={d.id}>
          <DriverTitle small>{d.fileName}</DriverTitle>
          <DriverCopy>
            {d.type.replace(/_/g, ' ')} · {d.verificationState}
          </DriverCopy>
          <DriverCopy>
            {d.expiresOn
              ? 'Expires ' + d.expiresOn.slice(0, 10)
              : 'Expiration not recorded'}
            {d.expired ? ' · Expired' : ''}
          </DriverCopy>
          <DriverButton
            title="Edit document metadata"
            disabled={!ready || request.busy || submitted.current}
            onPress={() => {
              setEditing(d);
              setType(d.type);
              setName(d.fileName);
              setIssued(d.issuedOn?.slice(0, 10) ?? '');
              setExpires(d.expiresOn?.slice(0, 10) ?? '');
              submitted.current = false;
              setConflict(false);
              createOperation.current = undefined;
            }}
          />
        </DriverCard>
      ))}
      <DriverTitle small>
        {editing ? 'Edit metadata' : 'Add metadata'}
      </DriverTitle>
      {conflict && (
        <DriverCard>
          <DriverCopy>
            The document changed. Your unsaved fields are preserved. Review the
            latest server record before intentionally merging your edits. No
            save was retried.
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
          title="Cancel editing / create new document"
          disabled={request.busy || submitted.current}
          onPress={resetForm}
        />
      )}
      {documentTypes.map(t => (
        <DriverButton
          key={t}
          title={t.replace(/_/g, ' ') + (type === t ? ' · Selected' : '')}
          secondary
          disabled={request.busy || submitted.current}
          onPress={() => setType(t)}
        />
      ))}
      <DriverField
        editable={!request.busy && !submitted.current}
        label="Document label"
        value={name}
        onChangeText={setName}
        maxLength={150}
      />
      <DriverField
        editable={!request.busy && !submitted.current}
        label="Issue date (YYYY-MM-DD, optional)"
        value={issued}
        onChangeText={setIssued}
      />
      <DriverField
        editable={!request.busy && !submitted.current}
        label="Expiration date (YYYY-MM-DD, optional)"
        value={expires}
        onChangeText={setExpires}
      />
      <DriverButton
        title="Save document metadata"
        disabled={
          !ready ||
          request.busy ||
          !name.trim() ||
          submitted.current ||
          conflict
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
        <Text>
          Save result unconfirmed. Retry sends the same operation and unchanged
          metadata.
        </Text>
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
            before starting a genuinely different document. Abandoning recovery
            does not delete any server record.
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
    </DriverPage>
  );
}
