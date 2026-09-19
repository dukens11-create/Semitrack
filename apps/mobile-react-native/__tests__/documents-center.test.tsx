import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { DocumentsScreen } from '../src/screens/DriverLibraryScreens';
import {
  DocumentCategories,
  DocumentDateField,
  DocumentRow,
  documentCategories,
  documentDay,
  documentExpiry,
} from '../src/components/DocumentsPresentation';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import { deferred, user } from './fixtures';
const mockDisk = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(async ({ service }) =>
    mockDisk.has(service) ? { password: mockDisk.get(service) } : false,
  ),
  setGenericPassword: jest.fn(async (_user, value, { service }) => {
    mockDisk.set(service, value);
    return true;
  }),
  resetGenericPassword: jest.fn(async ({ service }) => {
    mockDisk.delete(service);
  }),
}));
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: {
    createOperationId: jest.fn(
      async () => '00000000-0000-4000-8000-000000000321',
    ),
  },
}));
const document = {
  id: 'doc',
  type: 'CDL',
  fileName: 'My CDL',
  revision: 1,
  truckId: null,
  issuedOn: null,
  expiresOn: null,
  verificationState: 'UNVERIFIED',
  expired: false,
  fileAvailable: false,
};
let screen: ReactTestRenderer;
const content = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const button = (label: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0]!;
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
async function setup({
  request = jest.fn(async () => ({ items: [] })),
  mode = 'day',
}: { request?: jest.Mock; mode?: 'day' | 'night' } = {}) {
  const services = {
    api: { request },
    auth: new Store({ status: 'signedIn', user }),
  } as unknown as Services;
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <DocumentsScreen services={services} />
      </DriverAppearanceContext.Provider>,
    );
  });
  return request;
}
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  mockDisk.clear();
  jest.restoreAllMocks();
});

test('initial loading never claims an empty library; records use no verification or file claims', async () => {
  const waiting = deferred<unknown>();
  await setup({ request: jest.fn(() => waiting.promise) });
  expect(content()).toContain('Loading documents');
  expect(content()).not.toContain('No documents yet');
  await act(async () => waiting.resolve({ items: [document] }));
  expect(content()).toContain('My CDL');
  expect(content()).not.toMatch(/metadata|Valid|Verified/);
  expect(content()).toContain('Labels and dates only');
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
  expect(button('Refresh documents')).toBeUndefined();
});
test.each(documentCategories)(
  '$label tile opens the correct form without a backend write',
  async category => {
    const request = await setup();
    await press('Add ' + category.label);
    expect(screen.root.findByType(TextInput).props.value).toBe(
      category.defaultLabel,
    );
    expect(button('Save document')).toBeDefined();
    expect(screen.root.findAllByType(DocumentDateField)).toHaveLength(2);
    expect(request.mock.calls).toEqual([['GET', '/documents']]);
  },
);
test('calendar selects real leap day and permits clearing without typed dates', async () => {
  const onChange = jest.fn();
  await act(async () => {
    screen = create(
      <DocumentDateField
        label="Issue date"
        value="2024-02-28"
        onChange={onChange}
        disabled={false}
      />,
    );
  });
  await press('Issue date');
  expect(button('Select 2024-02-30')).toBeUndefined();
  await press('Select 2024-02-29');
  expect(onChange).toHaveBeenCalledWith('2024-02-29');
  await press('Issue date');
  await press('Clear date');
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
});
test('calendar year and month selection works for older and future records; cancel keeps original date', async () => {
  const onChange = jest.fn();
  await act(async () => {
    screen = create(
      <DocumentDateField
        label="Expiration date"
        value="2024-02-28"
        onChange={onChange}
        disabled={false}
      />,
    );
  });
  await press('Expiration date');
  await press(
    new Date(2024, 1, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    }),
  );
  await press('Year 2028');
  await press(
    new Date(2028, 1, 1).toLocaleDateString(undefined, { month: 'long' }),
  );
  await press('Select 2028-02-29');
  expect(onChange).toHaveBeenCalledWith('2028-02-29');
  onChange.mockClear();
  await press('Expiration date');
  await press('Next');
  await press('Cancel date selection');
  expect(onChange).not.toHaveBeenCalled();
});
test('date-only expiration math handles missing, invalid, today and the 90-day boundary', () => {
  const now = new Date(2026, 8, 17, 12);
  expect(documentDay('2026-02-30')).toBeUndefined();
  expect(documentExpiry(null, now).label).toBe('No expiration date');
  expect(documentExpiry('2026-09-16', now).expired).toBe(true);
  expect(documentExpiry('2026-09-17', now).label).toBe('Expires today');
  expect(documentExpiry('2026-12-16', now)).toMatchObject({
    days: 90,
    soon: true,
  });
  expect(documentExpiry('2026-12-17', now)).toMatchObject({
    days: 91,
    soon: false,
  });
  expect(documentDay('2026-09-17T00:00:00Z')).toBe(Date.UTC(2026, 8, 17));
});
test('Expiring Soon derives only from saved dates; expired and undated rows stay in My Documents', async () => {
  const now = new Date();
  const date = (offset: number) =>
    new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset),
    ).toISOString();
  const items = [
    { ...document, id: 'soon', fileName: 'Due soon', expiresOn: date(30) },
    { ...document, id: 'past', fileName: 'Past', expiresOn: date(-1) },
    { ...document, id: 'none', fileName: 'Undated' },
    { ...document, id: 'later', fileName: 'Later', expiresOn: date(91) },
  ];
  await setup({ request: jest.fn(async () => ({ items })) });
  const rows = screen.root.findAllByType(DocumentRow);
  expect(rows.filter(n => n.props.document.id === 'soon')).toHaveLength(2);
  expect(rows.filter(n => n.props.document.id === 'past')).toHaveLength(1);
  expect(rows.filter(n => n.props.document.id === 'none')).toHaveLength(1);
  expect(rows.filter(n => n.props.document.id === 'later')).toHaveLength(1);
  expect(content()).toContain('In 30 days');
  expect(content()).toContain('Expired');
  expect(content()).not.toContain('Valid');
});
test('invalid date order blocks saving; valid selected dates use the unchanged API contract', async () => {
  const request = jest.fn(async method =>
    method === 'GET' ? { items: [] } : {},
  );
  await setup({ request });
  await press('Add CDL');
  const dates = () => screen.root.findAllByType(DocumentDateField);
  await act(async () => {
    dates()[0]!.props.onChange('2026-05-10');
    dates()[1]!.props.onChange('2026-05-09');
  });
  expect(button('Save document').props.disabled).toBe(true);
  expect(content()).toContain('Expiration date must be on or after');
  expect(request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
  await act(async () => dates()[1]!.props.onChange('2027-05-10'));
  await press('Save document');
  expect(request).toHaveBeenCalledWith(
    'POST',
    '/documents',
    expect.objectContaining({
      type: 'CDL',
      fileName: 'Commercial Driver License',
      issuedOn: '2026-05-10',
      expiresOn: '2027-05-10',
      truckId: null,
    }),
  );
  expect(screen.root.findAllByType(TextInput)).toHaveLength(0);
  expect(content()).toContain('Document saved.');
});
test('refresh failures retain saved records; initial failure offers compact retry', async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [document] })
    .mockRejectedValue(new Error('offline'));
  await setup({ request });
  expect(content()).not.toContain('No documents yet');
  await press('Retry documents');
  await act(async () =>
    screen.root.findByType(ScrollView).props.refreshControl.props.onRefresh(),
  );
  expect(content()).toContain('My CDL');
  expect(content()).toContain('Showing last loaded documents.');
});
test.each(['day', 'night'] as const)(
  '%s uses semantic icon colors, two columns and scroll clearance',
  async mode => {
    await setup({ mode });
    const scroller = screen.root.findByType(ScrollView);
    expect(StyleSheet.flatten(scroller.props.style).backgroundColor).toBe(
      mode === 'day' ? '#F3F5F7' : '#0C131B',
    );
    expect(
      StyleSheet.flatten(scroller.props.contentContainerStyle).paddingBottom,
    ).toBeGreaterThanOrEqual(28);
    expect(
      new Set(documentCategories.map(c => (mode === 'day' ? c.day : c.night)))
        .size,
    ).toBeGreaterThan(5);
    expect(StyleSheet.flatten(button('Add CDL').props.style).width).toBe(
      '48.5%',
    );
  },
);
test('closing an unsaved form retains the draft and type editing does not reset saved fields', async () => {
  await setup();
  await press('Add CDL');
  await act(async () =>
    screen.root.findByType(TextInput).props.onChangeText('Personal label'),
  );
  await press('Close Add CDL');
  await press('Continue editing document');
  expect(screen.root.findByType(TextInput).props.value).toBe('Personal label');
  await press('Change document type');
  const grid = screen.root.findAllByType(DocumentCategories).at(-1)!;
  await act(async () => grid.props.onSelect('MEDICAL'));
  expect(screen.root.findByType(TextInput).props.value).toBe('Personal label');
  expect(button('Close Add Medical')).toBeDefined();
});
