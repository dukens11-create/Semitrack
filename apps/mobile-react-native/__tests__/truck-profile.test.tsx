import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, Switch, TextInput } from 'react-native';
import { TruckProfileScreen } from '../src/screens/TruckProfileScreen';
import { TruckProfileStore } from '../src/features/truckProfile/TruckProfileStore';
import {
  duplicateProfile,
  suggestedLengths,
  trailerTypes,
  verifyRoutingProfile,
} from '../src/features/truckProfile/equipment';
import { serializeTruck, type TruckProfile } from '../src/models/contracts';
import type { ApiClient } from '../src/services/api/ApiClient';
import type { Services } from '../src/app/services';
import { Button } from '../src/components/ui';
import { truck, deferred } from './fixtures';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
const valid = {
  ...truck,
  lengthFt: 53,
  tractorType: 'Sleeper Cab',
  trailerType: 'Dry Van',
};
function setup(profiles: TruckProfile[] = [{ ...valid }]) {
  let items = profiles.map(item => ({ ...item }));
  const request = jest.fn(
    async (method: string, path: string, body?: TruckProfile) => {
      if (method === 'GET') return { items: items.map(item => ({ ...item })) };
      if (path.endsWith('/verify')) {
        const id = path.split('/')[2];
        items = items.map(item => ({
          ...item,
          isDefault: item.id === id,
          verifiedRevision: item.revision,
          verifiedAt: '2026-09-12T12:00:00Z',
          verificationState: 'VERIFIED' as const,
        }));
        return;
      }
      if (method === 'DELETE') {
        items = items.filter(item => !path.endsWith('/' + item.id));
        return;
      }
      const id = method === 'PATCH' ? path.split('/')[2]! : 'new-truck';
      const saved = {
        ...body!,
        id,
        revision: (items.find(item => item.id === id)?.revision ?? 0) + 1,
        isDefault: false,
        verifiedRevision: null,
        verifiedAt: null,
        verificationState: 'DRIVER_VERIFICATION_REQUIRED' as const,
      };
      items = [...items.filter(item => item.id !== id), saved];
      return saved;
    },
  );
  const onChange = jest.fn();
  const store = new TruckProfileStore(
    { request } as unknown as ApiClient,
    onChange,
    async () => '11111111-1111-4111-8111-111111111111',
  );
  return {
    store,
    request,
    onChange,
    mutate: (next: TruckProfile[]) => {
      items = next;
    },
  };
}
test('legacy default requires review; unchanged refresh keeps confirmation; external changes invalidate it', async () => {
  const { store, mutate, onChange } = setup([
    {
      ...valid,
      verifiedRevision: null,
      verificationState: 'DRIVER_VERIFICATION_REQUIRED',
    },
  ]);
  await store.load();
  expect(store.getSnapshot().selected).toBeNull();
  await store.select(valid);
  expect(store.getSnapshot().selected?.id).toBe(valid.id);
  await store.load();
  expect(store.getSnapshot().selected?.lengthFt).toBe(53);
  mutate([{ ...valid, heightFt: 14 }]);
  await store.load();
  expect(store.getSnapshot().selected).toBeNull();
  expect(onChange).toHaveBeenCalled();
  await expect(store.select(valid)).rejects.toThrow('changed');
});
test('save invalidates active profile and does not automatically activate changed values', async () => {
  const { store } = setup();
  await store.load();
  await store.select(valid);
  const saved = await store.save({ ...valid, lengthFt: 48 });
  expect(store.getSnapshot().selected).toBeNull();
  await store.select(saved);
  expect(store.getSnapshot().selected?.lengthFt).toBe(48);
  store.clear();
  expect(store.getSnapshot().selected).toBeNull();
});
test('default request failure leaves no active profile and never routes an unverified replacement', async () => {
  const { store, request } = setup();
  await store.load();
  await store.select(valid);
  request.mockRejectedValueOnce(new Error('offline'));
  await expect(store.select(valid)).rejects.toThrow('offline');
  expect(store.getSnapshot().selected).toBeNull();
});
test('sign-out during activation cannot restore confirmation', async () => {
  const { store, request } = setup();
  await store.load();
  const pending = deferred<undefined>();
  request.mockImplementationOnce(() => pending.promise);
  const activation = store.select(valid);
  store.clear();
  pending.resolve(undefined);
  await expect(activation).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(store.getSnapshot().selected).toBeNull();
});
test('duplicate preserves actual specs but gets no id or default selection', () => {
  const copy = duplicateProfile(valid);
  expect(copy.id).toBe('');
  expect(copy.isDefault).toBe(false);
  expect(copy.name).toContain('(copy)');
  expect(copy.heightFt).toBe(valid.heightFt);
  expect(copy.currentWeightLbs).toBe(valid.currentWeightLbs);
  expect(copy.hazardousGoods).not.toBe(valid.hazardousGoods);
});
test('provider limits and trailer contradictions cannot be confirmed or silently clamped', () => {
  for (const invalid of [
    { lengthFt: 72 },
    { widthFt: 9 },
    { axleCount: 15 },
    { weightPerAxleLbs: 500 },
    { currentWeightLbs: 81000 },
    { trailerCount: 0 },
    { trailerType: 'No Trailer' },
    { trailerType: 'RV' },
  ]) {
    expect(() => verifyRoutingProfile({ ...valid, ...invalid })).toThrow();
  }
  expect(
    verifyRoutingProfile({
      ...valid,
      trailerType: 'No Trailer',
      trailerCount: 0,
    }).trailerCount,
  ).toBe(0);
  expect(
    verifyRoutingProfile({
      ...valid,
      tractorType: 'Custom heavy truck',
      trailerType: 'Custom commercial trailer',
      axleCount: 14,
      trailerCount: 4,
    }).axleCount,
  ).toBe(14);
});
test('every commercial option maps through existing route payload; identification stays separate', () => {
  for (const trailerType of trailerTypes.filter(
    item => item !== 'Other / Custom',
  )) {
    const value = verifyRoutingProfile({
      ...valid,
      trailerType,
      trailerCount: trailerType === 'No Trailer' ? 0 : 1,
    });
    const payload = serializeTruck(value, true);
    expect(payload.trailerType).toBe(trailerType);
    expect(payload.heightFt).toBe(13.5);
    expect(payload.weightLbs).toBe(80000);
    expect(payload.currentWeightLbs).toBe(76000);
    expect(payload.weightPerAxleLbs).toBe(17000);
    expect(payload.axleCount).toBe(5);
    expect(payload).not.toHaveProperty('tractorType');
    expect(payload).not.toHaveProperty('unitNumber');
  }
});
test('only sourced length suggestions are offered; specialized types stay custom', () => {
  expect(suggestedLengths('dry van')).toEqual([28, 48, 53]);
  expect(suggestedLengths('Reefer')).toEqual([28, 36, 48, 53]);
  expect(suggestedLengths('Lowboy')).toEqual([]);
  expect(suggestedLengths('No Trailer')).toEqual([]);
});
let screen: ReactTestRenderer | undefined;
async function mount(profiles?: TruckProfile[]) {
  const values = setup(profiles);
  await act(async () => {
    screen = create(
      <TruckProfileScreen
        services={{ trucks: values.store } as unknown as Services}
      />,
    );
  });
  return values;
}
async function press(title: string, index = 0) {
  await act(async () => {
    screen!.root
      .findAllByType(Button)
      .filter(button => button.props.title === title)
      [index]!.props.onPress();
  });
}
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
});
test('Set Active shows all thirteen values; acknowledgement is required before activation', async () => {
  const { store } = await mount([
    {
      ...valid,
      verifiedRevision: null,
      verificationState: 'DRIVER_VERIFICATION_REQUIRED',
    },
  ]);
  await press('Set Active');
  const json = JSON.stringify(screen!.toJSON());
  for (const label of [
    'Profile name',
    'Tractor type',
    'Trailer type',
    'Unit number',
    'Trailer number',
    'Height (ft)',
    'Width (ft)',
    'Length (ft)',
    'Gross weight',
    'Current weight',
    'Weight per axle',
    'Axles',
    'Trailers',
  ])
    expect(json).toContain(label);
  expect(
    screen!.root
      .findAllByType(Button)
      .find(b => b.props.title === 'Confirm & Use')!.props.disabled,
  ).toBe(true);
  expect(store.getSnapshot().selected).toBeNull();
  await act(async () => {
    screen!.root
      .findAllByType(Switch)
      .find(
        s =>
          s.props.accessibilityLabel === 'I verified the actual truck and load',
      )!
      .props.onValueChange(true);
  });
  await press('Confirm & Use');
  expect(store.getSnapshot().selected?.id).toBe(valid.id);
});
test('length suggestions change only editable length; custom retains every numeric field', async () => {
  await mount();
  await press('Edit');
  await press('48 ft');
  const field = (label: string) =>
    screen!.root
      .findAllByType(TextInput)
      .find(f => f.props.accessibilityLabel === label)!;
  expect(field('Length (ft)').props.value).toBe('48');
  expect(field('Height (ft)').props.value).toBe('13');
  expect(field('Height (in)').props.value).toBe('6');
  expect(field('Current weight (lb, optional)').props.value).toBe('76000');
  await act(async () => field('Length (ft)').props.onChangeText('50'));
  expect(field('Length (ft)').props.value).toBe('50');
});
test('duplicate opens an unsaved form; review does not call API until confirmed', async () => {
  const { request, store } = await mount();
  await press('Duplicate');
  await press('Review truck profile');
  expect(request.mock.calls.filter(call => call[0] !== 'GET')).toHaveLength(0);
  expect(store.getSnapshot().selected?.id).toBe(valid.id);
  await act(async () => {
    screen!.root
      .findAllByType(Switch)
      .find(
        s =>
          s.props.accessibilityLabel === 'I verified the actual truck and load',
      )!
      .props.onValueChange(true);
  });
  await press('Confirm & Use');
  expect(store.getSnapshot().selected?.id).toBe('new-truck');
});

test('excessive height shows a field message and sends no API mutation', async () => {
  const { request } = await mount();
  await press('Edit');
  await act(async () =>
    screen!.root
      .findAllByType(TextInput)
      .find(f => f.props.accessibilityLabel === 'Height (ft)')!
      .props.onChangeText('162'),
  );
  await press('Review truck profile');
  const text = JSON.stringify(screen!.toJSON());
  expect(text).toContain('measured loaded height');
  expect(text).not.toMatch(/too_big|received|heightFt/);
  expect(request.mock.calls.filter(call => call[0] !== 'GET')).toHaveLength(0);
  expect(
    screen!.root
      .findAllByType(Button)
      .some(b => b.props.title === 'Confirm & Use'),
  ).toBe(false);
});
test('height and width inches reach saved API payload as decimal feet after confirmation', async () => {
  const { request } = await mount();
  await press('Duplicate');
  await press('Review truck profile');
  await act(async () =>
    screen!.root
      .findAllByType(Switch)
      .find(
        s =>
          s.props.accessibilityLabel === 'I verified the actual truck and load',
      )!
      .props.onValueChange(true),
  );
  await press('Confirm & Use');
  const mutation = request.mock.calls.find(
    call => call[0] === 'POST' && call[1] === '/trucks',
  )!;
  expect(mutation[2]).toMatchObject({
    heightFt: 13.5,
    widthFt: 8.5,
    lengthFt: 53,
  });
  expect(mutation[2]).not.toHaveProperty('heightIn');
});

test('rapid confirmation taps issue exactly one profile mutation', async () => {
  const { request } = await mount();
  await press('Duplicate');
  await press('Review truck profile');
  await act(async () =>
    screen!.root
      .findAllByType(Switch)
      .find(
        s =>
          s.props.accessibilityLabel === 'I verified the actual truck and load',
      )!
      .props.onValueChange(true),
  );
  const confirm = screen!.root
    .findAllByType(Button)
    .find(b => b.props.title === 'Confirm & Use')!;
  await act(async () => {
    confirm.props.onPress();
    confirm.props.onPress();
  });
  expect(
    request.mock.calls.filter(
      call => call[0] === 'POST' && call[1] === '/trucks',
    ),
  ).toHaveLength(1);
});

test('confirmation reloads remote revision and never automatically verifies changed values', async () => {
  const { store, request, mutate } = setup();
  await store.load();
  mutate([
    {
      ...valid,
      revision: 2,
      heightFt: 14,
      verifiedRevision: null,
      verificationState: 'ADMIN_UPDATED',
    },
  ]);
  await expect(store.select(valid)).rejects.toMatchObject({
    code: 'TRUCK_PROFILE_CHANGED',
  });
  expect(store.getSnapshot().profiles[0]?.heightFt).toBe(14);
  expect(request.mock.calls.some(call => call[1].endsWith('/verify'))).toBe(
    false,
  );
});
test('409 verification refreshes state once without retrying the mutation', async () => {
  const { store, request } = setup();
  await store.load();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, path, body) => {
    if (path.endsWith('/verify')) throw { status: 409 };
    return original(method, path, body);
  });
  await expect(store.select(valid)).rejects.toMatchObject({
    code: 'TRUCK_PROFILE_CHANGED',
  });
  expect(
    request.mock.calls.filter(call => call[1].endsWith('/verify')),
  ).toHaveLength(1);
  expect(store.getSnapshot().selected).toBeNull();
});
test('successful create retains its identity before any later readback failure', async () => {
  const { store, request } = setup([]);
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, path, body) => {
    if (method === 'GET') throw { status: 503 };
    return original(method, path, body);
  });
  const saved = await store.save(duplicateProfile(valid));
  expect(saved.id).toBe('new-truck');
  expect(store.getSnapshot().profiles[0]?.id).toBe(saved.id);
  await expect(store.select(saved)).rejects.toMatchObject({ status: 503 });
  expect(
    request.mock.calls.filter(
      call => call[0] === 'POST' && call[1] === '/trucks',
    ),
  ).toHaveLength(1);
});

test('retry after successful create and failed verification never posts a second profile', async () => {
  const { request } = await mount();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, path, body) => {
    if (path.endsWith('/verify')) throw { status: 503 };
    return original(method, path, body);
  });
  await press('Duplicate');
  await press('Review truck profile');
  const acknowledge = async () =>
    act(async () =>
      screen!.root
        .findAllByType(Switch)
        .find(
          s =>
            s.props.accessibilityLabel ===
            'I verified the actual truck and load',
        )!
        .props.onValueChange(true),
    );
  await acknowledge();
  await press('Confirm & Use');
  expect(
    screen!.root
      .findAllByType(Button)
      .find(b => b.props.title === 'Confirm & Use')!.props.disabled,
  ).toBe(true);
  await acknowledge();
  await press('Confirm & Use');
  expect(
    request.mock.calls.filter(
      call => call[0] === 'POST' && call[1] === '/trucks',
    ),
  ).toHaveLength(1);
  expect(
    request.mock.calls.filter(call => call[1].endsWith('/verify')),
  ).toHaveLength(2);
});

test('created identity survives failed verify, Android Back and reopening review', async () => {
  const { request } = await mount();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (method, path, body) => {
    if (path.endsWith('/verify')) throw { status: 503 };
    return original(method, path, body);
  });
  await press('Duplicate');
  await press('Review truck profile');
  const acknowledge = async () =>
    act(async () =>
      screen!.root
        .findAllByType(Switch)
        .find(
          s =>
            s.props.accessibilityLabel ===
            'I verified the actual truck and load',
        )!
        .props.onValueChange(true),
    );
  await acknowledge();
  await press('Confirm & Use');
  await act(async () => screen!.root.findByType(Modal).props.onRequestClose());
  await press('Review truck profile');
  await acknowledge();
  await press('Confirm & Use');
  expect(
    request.mock.calls.filter(
      call => call[0] === 'POST' && call[1] === '/trucks',
    ),
  ).toHaveLength(1);
  expect(
    request.mock.calls.filter(call => call[1].endsWith('/verify')),
  ).toHaveLength(2);
});
test('ambiguous create retries the same operation, including after dialog close', async () => {
  const { request } = await mount();
  const original = request.getMockImplementation()!;
  let lost = true;
  request.mockImplementation(async (method, path, body) => {
    if (method === 'POST' && path === '/trucks' && lost) {
      lost = false;
      await original(method, path, body);
      throw { code: 'REQUEST_TIMEOUT', status: 0 };
    }
    return original(method, path, body);
  });
  await press('Duplicate');
  await press('Review truck profile');
  const acknowledge = async () =>
    act(async () =>
      screen!.root
        .findAllByType(Switch)
        .find(
          s =>
            s.props.accessibilityLabel ===
            'I verified the actual truck and load',
        )!
        .props.onValueChange(true),
    );
  await acknowledge();
  await press('Confirm & Use');
  await act(async () => screen!.root.findByType(Modal).props.onRequestClose());
  await press('Review truck profile');
  await acknowledge();
  await press('Confirm & Use');
  const creates = request.mock.calls.filter(
    call => call[0] === 'POST' && call[1] === '/trucks',
  );
  expect(creates).toHaveLength(2);
  expect(creates[0]![2]?.createOperationId).toBeTruthy();
  expect(creates[1]![2]?.createOperationId).toBe(
    creates[0]![2]?.createOperationId,
  );
});
