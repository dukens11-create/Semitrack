import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { DocumentDateField } from '../src/components/DocumentsPresentation';
let mockOperation = 0;
const mockSecureDocuments = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(async ({ service }) =>
    mockSecureDocuments.has(service)
      ? { password: mockSecureDocuments.get(service) }
      : false,
  ),
  setGenericPassword: jest.fn(async (_user, value, { service }) => {
    mockSecureDocuments.set(service, value);
    return true;
  }),
  resetGenericPassword: jest.fn(async ({ service }) => {
    mockSecureDocuments.delete(service);
    return true;
  }),
}));
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: {
    createOperationId: jest.fn(
      async () =>
        '00000000-0000-4000-8000-' + String(++mockOperation).padStart(12, '0'),
    ),
  },
}));
import {
  TripsScreen,
  DocumentsScreen,
  planFromTrip,
} from '../src/screens/DriverLibraryScreens';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import { AuthStore } from '../src/features/auth/AuthStore';
import { ApiClient } from '../src/services/api/ApiClient';
import { safeDriverError } from '../src/errors/driverErrors';
import { PendingDocumentCreates } from '../src/services/storage/PendingDocumentCreates';
import * as Keychain from 'react-native-keychain';
let tree: ReactTestRenderer;
const trip = {
  id: 'synthetic-trip',
  name: 'Ordered assignment',
  status: 'ASSIGNED',
  revision: 1,
  origin: { id: 'o', name: 'Origin', lat: 40, lng: -120 },
  destination: { id: 'd', name: 'Destination', lat: 41, lng: -120 },
  stops: [
    { id: 'a', name: 'Stop A', lat: 40.1, lng: -120 },
    { id: 'b', name: 'Stop B', lat: 40.2, lng: -120 },
  ],
  assigned: true,
  startedAt: null,
  completedAt: null,
};
function services(request: jest.Mock) {
  return {
    api: { request },
    auth: new Store({ status: 'signedIn', user: { id: 'synthetic-user' } }),
    routes: Object.assign(new Store({ route: null, plan: null }), {
      clear: jest.fn(),
    }),
    trucks: new Store({ selected: null }),
  } as unknown as Services;
}
async function press(label: string) {
  await act(async () => {
    tree.root
      .findAll(
        n =>
          n.props.accessibilityLabel === label &&
          typeof n.props.onPress === 'function',
      )[0]!
      .props.onPress();
  });
}
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.clearAllMocks();
  mockSecureDocuments.clear();
});
test('restored saved trip uses canonical StopPlan and rejects duplicate ordered stops', () => {
  expect(planFromTrip(trip).stops.map(s => s.id)).toEqual(['o', 'a', 'b']);
  expect(planFromTrip(trip).destination.id).toBe('d');
  expect(() =>
    planFromTrip({ ...trip, stops: [trip.stops[0], trip.stops[0]] }),
  ).toThrow();
});
test('assignment entry is read-only; acceptance requires explicit confirmation and exact revision', async () => {
  const request = jest.fn().mockResolvedValue({ items: [trip] });
  const s = services(request);
  await act(async () => {
    tree = create(<TripsScreen services={s} onMap={jest.fn()} />);
  });
  expect(request.mock.calls.map(c => c[0])).toEqual(['GET']);
  await press('More: Ordered assignment');
  await press('Accept assignment');
  expect(request.mock.calls.length).toBe(1);
  request.mockImplementation(async method =>
    method === 'PATCH'
      ? { ...trip, status: 'PLANNED', revision: 2 }
      : { items: [{ ...trip, status: 'PLANNED', revision: 2 }] },
  );
  await press('Confirm trip update');
  expect(request).toHaveBeenCalledWith(
    'PATCH',
    '/trips/synthetic-trip/status',
    { expectedRevision: 1, status: 'PLANNED' },
  );
  expect(request.mock.calls.at(-1)?.[0]).toBe('GET');
});
test('revision conflict refreshes latest trip without automatic status retry', async () => {
  let count = 0;
  const request: jest.Mock = jest.fn(async method => {
    if (method === 'PATCH') {
      count++;
      throw { code: 'TRIP_CHANGED', status: 409 };
    }
    return { items: [trip] };
  });
  await act(async () => {
    tree = create(
      <TripsScreen services={services(request)} onMap={jest.fn()} />,
    );
  });
  await press('More: Ordered assignment');
  await press('Accept assignment');
  await press('Confirm trip update');
  expect(count).toBe(1);
  expect(
    tree.root
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat(Infinity))
      .join(''),
  ).toContain('This trip changed');
});
test('documents render actual stored expiration and no public storage action', async () => {
  const request = jest.fn().mockResolvedValue({
    items: [
      {
        id: 'doc',
        type: 'CDL',
        fileName: 'Synthetic label',
        revision: 1,
        truckId: null,
        issuedOn: null,
        expiresOn: '2025-01-01T00:00:00.000Z',
        verificationState: 'UNVERIFIED',
        expired: true,
        fileAvailable: false,
      },
    ],
  });
  await act(async () => {
    tree = create(<DocumentsScreen services={services(request)} />);
  });
  const text = tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .join(' ');
  expect(text).toContain('Expired');
  expect(text).toContain('Labels and dates only.');
  expect(text).not.toContain('metadata');
  expect(request).toHaveBeenCalledTimes(1);
});
test('password change uses existing API and clears local session only after successful replacement', async () => {
  const request = jest.fn().mockResolvedValue(undefined),
    vault = {
      read: jest.fn().mockResolvedValue(null),
      clear: jest.fn().mockResolvedValue(undefined),
      write: jest.fn(),
    };
  const api = {
    request,
    invalidateSession: jest.fn(),
    revokeSession: jest.fn(),
  } as unknown as ApiClient;
  const auth = new AuthStore(api, vault);
  await auth.changePassword('synthetic current', 'synthetic replacement');
  expect(request).toHaveBeenCalledWith('POST', '/auth/password/change', {
    currentPassword: 'synthetic current',
    password: 'synthetic replacement',
  });
  expect(vault.clear).toHaveBeenCalledTimes(1);
  expect(auth.getSnapshot().status).toBe('signedOut');
  request.mockRejectedValueOnce({ code: 'CURRENT_PASSWORD_INVALID' });
  await expect(
    auth.changePassword('wrong', 'synthetic replacement'),
  ).rejects.toEqual({ code: 'CURRENT_PASSWORD_INVALID' });
  expect(vault.clear).toHaveBeenCalledTimes(1);
  expect(safeDriverError({ code: 'CURRENT_PASSWORD_INVALID' })).toContain(
    'current password',
  );
});

test('document double-submit and lost-response retry preserve one create operation; next record gets a new operation', async () => {
  let lost = true;
  const request: jest.Mock = jest.fn(async method => {
    if (method === 'GET') return { items: [] };
    if (lost) {
      lost = false;
      throw { code: 'NETWORK_UNAVAILABLE', status: 0 };
    }
    return {};
  });
  await act(async () => {
    tree = create(<DocumentsScreen services={services(request)} />);
  });
  await press('Add CDL');
  const input = () =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Document label')!;
  await act(async () => {
    input().props.onChangeText('Synthetic label');
  });
  const button = tree.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Save document' &&
      typeof n.props.onPress === 'function',
  )[0]!;
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
  expect(input().props.editable).toBe(false);
  await press('Retry same document save');
  const creates = request.mock.calls.filter(c => c[0] === 'POST');
  expect(creates).toHaveLength(2);
  expect(creates[1]![2]).toEqual(creates[0]![2]);
  await press('Add CDL');
  await act(async () => {
    input().props.onChangeText('A different synthetic record');
  });
  await press('Save document');
  const all = request.mock.calls.filter(c => c[0] === 'POST');
  expect(all).toHaveLength(3);
  expect(all[2]![2].createOperationId).not.toEqual(
    all[0]![2].createOperationId,
  );
});

const document = {
  id: 'doc',
  type: 'CDL',
  fileName: 'Synthetic label',
  revision: 1,
  truckId: null,
  issuedOn: '2025-01-01T00:00:00Z',
  expiresOn: '2025-12-31T00:00:00Z',
  verificationState: 'UNVERIFIED',
  expired: true,
  fileAvailable: false,
};
function field(label: string) {
  return tree.root
    .findAllByType(TextInput)
    .find(n => n.props.accessibilityLabel === label)!;
}
async function fill(label: string, value: string) {
  if (label === 'Document label' && !field(label)) await press('Add CDL');
  await act(async () => field(label).props.onChangeText(value));
}
function actionButton(label: string) {
  return tree.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
}

test.each([false, true])(
  'dispatch includes pickup from current GPS even when driver at pickup=%s; completed prefix survives reload/reroute',
  async atPickup => {
    let current = {
      ...trip,
      status: 'PLANNED',
      completedStopIds: [] as string[],
    };
    const request = jest.fn(async () => ({ items: [current] })),
      s = services(request);
    const calculate = jest.fn().mockResolvedValue(true);
    Object.assign(s.routes, { calculate });
    Object.assign(s, {
      location: {
        getFreshFix: () => ({ latitude: atPickup ? 40 : 39, longitude: -120 }),
      },
    });
    (s.trucks as any).publish({ selected: { id: 'truck', revision: 1 } });
    await act(async () => {
      tree = create(<TripsScreen services={s} onMap={jest.fn()} />);
    });
    await press('View trip: Ordered assignment');
    await press('Calculate with current verified truck');
    await press('View trip: Ordered assignment');
    await press('Calculate with current verified truck');
    expect(calculate.mock.calls[0][0]).toEqual({
      lat: atPickup ? 40 : 39,
      lng: -120,
    });
    expect(calculate.mock.calls[0][1].stops.map((p: any) => p.id)).toEqual([
      'o',
      'a',
      'b',
    ]);
    expect(calculate.mock.calls[1]![1]).toEqual(calculate.mock.calls[0]![1]);
    current = { ...current, completedStopIds: ['o'] };
    await press('View trip: Ordered assignment');
    await press('Calculate with current verified truck');
    expect(calculate.mock.calls[2][1].stops.map((p: any) => p.id)).toEqual([
      'a',
      'b',
    ]);
    await act(async () => tree.unmount());
    await act(async () => {
      tree = create(<TripsScreen services={s} onMap={jest.fn()} />);
    });
    await press('View trip: Ordered assignment');
    await press('Calculate with current verified truck');
    expect(calculate.mock.calls[3][1].stops.map((p: any) => p.id)).toEqual([
      'a',
      'b',
    ]);
  },
);
test('GPS pickup/delivery, multiple business stops, malformed completion and route capacity remain fail closed', () => {
  expect(planFromTrip({ ...trip, stops: [] }).stops.map(p => p.id)).toEqual([
    'o',
  ]);
  expect(
    planFromTrip({ ...trip, completedStopIds: ['o', 'a'] }).stops.map(
      p => p.id,
    ),
  ).toEqual(['b']);
  for (const completedStopIds of [['a'], ['o', 'b'], ['o', 'a', 'b', 'd']])
    expect(() => planFromTrip({ ...trip, completedStopIds })).toThrow();
  expect(() =>
    planFromTrip({
      ...trip,
      stops: Array.from({ length: 20 }, (_, i) => ({
        ...trip.stops[0],
        id: 'stop' + i,
      })),
    }),
  ).toThrow();
  expect(
    planFromTrip({ ...trip, assigned: false }).stops.map(p => p.id),
  ).toEqual(['a', 'b']);
});
test('stop completion is explicit, revision checked, and is never inferred by opening the trip', async () => {
  const request = jest.fn(async method =>
    method === 'GET' ? { items: [{ ...trip, status: 'STARTED' }] } : {},
  );
  await act(async () => {
    tree = create(
      <TripsScreen services={services(request)} onMap={jest.fn()} />,
    );
  });
  await press('More: Ordered assignment');
  await press('Record next stop completed');
  expect(request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
  await press('Confirm trip update');
  expect(request).toHaveBeenCalledWith(
    'PATCH',
    '/trips/synthetic-trip/status',
    { expectedRevision: 1, status: 'IN_PROGRESS', completedStopId: 'o' },
  );
});
test('document repeated conflict requires review of newest server revision and preserves draft before intentional save', async () => {
  let current = document;
  let conflict = true;
  const request = jest.fn(async method => {
    if (method === 'PATCH') {
      if (conflict) {
        current = {
          ...current,
          revision: current.revision + 1,
          fileName: 'Server ' + (current.revision + 1),
        };
        throw { status: 409, code: 'DOCUMENT_CHANGED' };
      }
      return { ...current, revision: current.revision + 1 };
    }
    return { items: [current] };
  });
  await act(async () => {
    tree = create(<DocumentsScreen services={services(request)} />);
  });
  await press('Edit document: Synthetic label');
  await fill('Document label', 'My unsaved edit');
  await press('Save document');
  expect(field('Document label').props.value).toBe('My unsaved edit');
  expect(actionButton('Save document').props.disabled).toBe(true);
  await press('Review latest and keep my edits');
  await press('Save document');
  expect(
    request.mock.calls
      .filter(c => c[0] === 'PATCH')
      .map(c => (c as any)[2].expectedRevision),
  ).toEqual([1, 2]);
  current = { ...current, revision: 4 };
  await press('Review latest and keep my edits');
  expect(actionButton('Save document').props.disabled).toBe(true);
  await press('Review latest and keep my edits');
  conflict = false;
  await press('Save document');
  expect(
    (request.mock.calls.filter(c => c[0] === 'PATCH').at(-1) as any)[2]
      .expectedRevision,
  ).toBe(4);
  expect(field('Document label')).toBeUndefined();
});
test.each(['save', 'cancel', 'conflict'])(
  'edit -> %s -> new document has canonical blank defaults',
  async mode => {
    const request = jest.fn(async method => {
      if (method === 'PATCH' && mode === 'conflict')
        throw { status: 409, code: 'DOCUMENT_CHANGED' };
      return method === 'GET' ? { items: [document] } : {};
    });
    await act(async () => {
      tree = create(<DocumentsScreen services={services(request)} />);
    });
    await press('Edit document: Synthetic label');
    if (mode === 'cancel') await press('Cancel editing');
    else {
      await press('Save document');
      if (mode === 'conflict') await press('Cancel editing');
    }
    await press('Add Insurance');
    expect(
      tree.root
        .findAllByType(DocumentDateField)
        .find(n => n.props.label === 'Issue date')!.props.value,
    ).toBe('');
    expect(
      tree.root
        .findAllByType(DocumentDateField)
        .find(n => n.props.label === 'Expiration date')!.props.value,
    ).toBe('');
    await fill('Document label', 'New insurance');
    await press('Save document');
    const body = (request.mock.calls.find(c => c[0] === 'POST') as any)[2];
    expect(body).toMatchObject({
      issuedOn: null,
      expiresOn: null,
      truckId: null,
      type: 'INSURANCE',
    });
    for (const key of [
      'id',
      'revision',
      'verificationState',
      'fileUrl',
      'userId',
    ])
      expect(body).not.toHaveProperty(key);
    await fill('Document label', 'Another document');
    await press('Save document');
    const creates = request.mock.calls.filter(c => c[0] === 'POST');
    expect((creates[1] as any)[2].createOperationId).not.toBe(
      body.createOperationId,
    );
  },
);
test('committed lost-response create survives remount and uses the exact persisted operation before creating a genuinely new record', async () => {
  const records = new Map<string, any>();
  let lose = true;
  const request = jest.fn(async (method, _path, body) => {
    if (method === 'GET') return { items: [...records.values()] };
    if (!records.has(body.createOperationId))
      records.set(body.createOperationId, {
        ...document,
        id: body.createOperationId,
        fileName: body.fileName,
      });
    if (lose) {
      lose = false;
      throw { status: 0, code: 'NETWORK_UNAVAILABLE' };
    }
    return records.get(body.createOperationId);
  });
  const s = services(request);
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  await fill('Document label', 'One logical document');
  await press('Save document');
  expect(records.size).toBe(1);
  await act(async () => tree.unmount());
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  expect(field('Document label').props.value).toBe('One logical document');
  expect(field('Document label').props.editable).toBe(false);
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
  await press('Retry same document save');
  expect(records.size).toBe(1);
  const posts = request.mock.calls.filter(c => c[0] === 'POST');
  expect(posts[1]![2]).toEqual(posts[0]![2]);
  await fill('Document label', 'Intentional second document');
  await press('Save document');
  expect(records.size).toBe(2);
});
test('secure storage failures block POST and another user cannot view or replay the prior owner pending operation', async () => {
  const request = jest.fn(async method => {
      if (method === 'GET') return { items: [] };
      throw { status: 0 };
    }),
    s = services(request);
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  await fill('Document label', 'Private label');
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(
    new Error('storage unavailable'),
  );
  await press('Save document');
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
  await press('Save document');
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
  await act(async () => tree.unmount());
  const other = services(request);
  (other.auth as any).publish({
    status: 'signedIn',
    user: { id: 'other-user' },
  });
  await act(async () => {
    tree = create(<DocumentsScreen services={other} />);
  });
  expect(field('Document label')).toBeUndefined();
  expect(
    tree.root
      .findAllByType(Text)
      .flatMap(n => [n.props.children].flat(Infinity))
      .join(''),
  ).not.toContain('Private label');
});
test('secure pending-create recovery survives a new storage wrapper; cross-owner and concurrent operations are isolated', async () => {
  const disk = new Map<string, string>();
  const storage = {
    read: async (owner: string) => disk.get(owner) ?? null,
    write: async (owner: string, value: string) => {
      disk.set(owner, value);
    },
    clear: async (owner: string) => {
      disk.delete(owner);
    },
  };
  const a = new PendingDocumentCreates(storage),
    body = {
      createOperationId: '00000000-0000-4000-8000-000000000099',
      type: 'CDL',
      fileName: 'Private label',
      issuedOn: null,
      expiresOn: null,
      truckId: null,
    };
  const [first, second] = await Promise.all([
    a.begin('a', body),
    a.begin('a', {
      ...body,
      createOperationId: '00000000-0000-4000-8000-000000000100',
    }),
  ]);
  expect(first).toEqual(second);
  const restarted = new PendingDocumentCreates(storage);
  expect(await restarted.read('a')).toEqual(body);
  expect(await restarted.read('b')).toBeNull();
  await restarted.complete('b', body.createOperationId);
  expect(await restarted.read('a')).toEqual(body);
  await restarted.complete('a', 'wrong-operation');
  expect(await restarted.read('a')).toEqual(body);
  await restarted.complete('a', body.createOperationId);
  expect(await restarted.read('a')).toBeNull();
});

test('abandoning unresolved recovery requires explicit confirmation; remount after a completed create starts blank', async () => {
  let lost = true;
  const request = jest.fn(async method => {
    if (method === 'GET') return { items: [] };
    if (lost) throw { status: 0, code: 'NETWORK_UNAVAILABLE' };
    return {};
  });
  const s = services(request);
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  await fill('Document label', 'Unconfirmed');
  await press('Save document');
  await press('Abandon document recovery');
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
  await press('Confirm abandon and start a different document');
  expect(field('Document label')).toBeUndefined();
  lost = false;
  await fill('Document label', 'Genuinely new');
  await press('Save document');
  const creates = request.mock.calls.filter(c => c[0] === 'POST');
  expect((creates[1] as any)[2].createOperationId).not.toBe(
    (creates[0] as any)[2].createOperationId,
  );
  await act(async () => tree.unmount());
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  expect(field('Document label')).toBeUndefined();
  await press('Add CDL');
  expect(
    tree.root
      .findAllByType(DocumentDateField)
      .find(n => n.props.label === 'Issue date')!.props.value,
  ).toBe('');
  expect(
    tree.root
      .findAllByType(DocumentDateField)
      .find(n => n.props.label === 'Expiration date')!.props.value,
  ).toBe('');
});

test('account replacement while secure write is pending cannot send the old owner document through the new session', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  (Keychain.setGenericPassword as jest.Mock).mockImplementationOnce(
    async (_u, v, { service }) => {
      await wait;
      mockSecureDocuments.set(service, v);
      return true;
    },
  );
  const request = jest.fn().mockResolvedValue({ items: [] }),
    s = services(request);
  await act(async () => {
    tree = create(<DocumentsScreen services={s} />);
  });
  await fill('Document label', 'Private owner draft');
  await act(async () => {
    actionButton('Save document').props.onPress();
    await Promise.resolve();
  });
  (s.auth as any).publish({
    status: 'signedIn',
    user: { id: 'replacement-account' },
  });
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(request.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});
