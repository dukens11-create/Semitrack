import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, Text } from 'react-native';
import { CopilotOfflineMap } from '../src/components/CopilotOfflineMap';
import {
  initialCopilotState,
  type CopilotState,
} from '../src/services/copilot/CopilotLifecycle';

const mockNativeMap = jest.fn(() => <Text>Actual CoPilot renderer</Text>);
jest.mock(
  'react-native/Libraries/ReactNative/requireNativeComponent',
  () => ({ __esModule: true, default: () => mockNativeMap }),
);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
}));

function verified(): CopilotState {
  return {
    ...initialCopilotState(),
    modules: { CopilotView: true },
    initialized: true,
    licensingReady: true,
    fullNavigationLicensed: true,
    heavyTruckLicensed: true,
    mapsReady: true,
    maps: {
      licensed: [42],
      installed: [
        { set: 42, year: 2026, quarter: 3, versionString: '2026 Q3' },
      ],
      mapsReady: true,
      updateStatus: 'CURRENT',
    },
  };
}
const originalOS = Platform.OS;
beforeAll(() => {
  Platform.OS = 'android';
});
afterAll(() => {
  Platform.OS = originalOS;
});
let screen: ReactTestRenderer;
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  mockNativeMap.mockClear();
});
async function render(state: CopilotState) {
  await act(async () => {
    screen = create(<CopilotOfflineMap state={state} />);
  });
}

test.each([
  ['native startup', { initialized: false }],
  ['Full Navigation', { fullNavigationLicensed: false }],
  ['Heavy-Duty Truck', { heavyTruckLicensed: false }],
  ['licensed inventory', { maps: null }],
  ['map verification', { mapsReady: false }],
  ['route failure', { error: 'COPILOT_ROUTE_FAILED' as const }],
])(
  'does not mount the native view before %s verification',
  async (_name, patch) => {
    await render({ ...verified(), ...patch });
    expect(mockNativeMap).not.toHaveBeenCalled();
  },
);

test('mounts the real SDK view after map checks, without requiring or starting guidance', async () => {
  const state = verified();
  expect(state.copilotReady).toBe(false);
  await render(state);
  expect(mockNativeMap).toHaveBeenCalled();
});

test('removes the native view immediately when startup is lost', async () => {
  await render(verified());
  expect(screen.root.findAllByType(mockNativeMap)).toHaveLength(1);
  await act(async () =>
    screen.update(
      <CopilotOfflineMap state={{ ...verified(), initialized: false }} />,
    ),
  );
  expect(screen.root.findAllByType(mockNativeMap)).toHaveLength(0);
});
