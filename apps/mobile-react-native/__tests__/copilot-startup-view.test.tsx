import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  CopilotStartupView,
  needsCopilotStartupView,
} from '../src/components/CopilotStartupView';
import { CopilotOfflineMap } from '../src/components/CopilotOfflineMap';
import { DriverButton } from '../src/components/DriverUI';
import { initialCopilotState } from '../src/services/copilot/CopilotLifecycle';
import { enrollmentMatchLabel } from '../src/services/copilot/enrollmentMatchLabel';
import type { CoPilotSetupDiagnostics } from '../src/services/copilot/CoPilotHost';
const mockRefresh = jest.fn();
let mockBlocker: string | null = null;
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotSetup: () => ({ refresh: mockRefresh }),
}));
jest.mock('../src/components/CopilotOfflineMap', () => ({
  CopilotOfflineMap: () => null,
  copilotMapBlocker: () => mockBlocker,
}));
test('setup view is limited to safe renderer access with route engine still unready', () => {
  const state = initialCopilotState();
  mockBlocker = 'License missing';
  expect(needsCopilotStartupView(state)).toBe(false);
  mockBlocker = null;
  expect(needsCopilotStartupView(state)).toBe(true);
  expect(needsCopilotStartupView({ ...state, readyToAddStops: true })).toBe(
    false,
  );
});
test('native setup mounts once and explicit refresh rechecks without restarting SDK', async () => {
  mockRefresh.mockResolvedValue(undefined);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CopilotStartupView state={initialCopilotState()} />);
  });
  expect(tree.root.findAllByType(CopilotOfflineMap)).toHaveLength(1);
  expect(mockRefresh).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByType(DriverButton).props.onPress();
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
test('missing enrollment reference is not displayed as incorrect credentials', () => {
  const diagnostics = { savedCompanyMatches: false } as CoPilotSetupDiagnostics;
  expect(enrollmentMatchLabel(diagnostics, 'savedCompanyMatches')).toContain(
    'Not evaluated',
  );
  expect(
    enrollmentMatchLabel(
      { ...diagnostics, enrollmentReferenceConfigured: false },
      'savedCompanyMatches',
    ),
  ).toContain('Not evaluated');
  expect(
    enrollmentMatchLabel(
      { ...diagnostics, enrollmentReferenceConfigured: true },
      'savedCompanyMatches',
    ),
  ).toBe('No');
  expect(
    enrollmentMatchLabel(
      {
        ...diagnostics,
        enrollmentReferenceConfigured: true,
        savedSetupPresent: false,
      },
      'savedCompanyMatches',
    ),
  ).toBe('No saved setup');
});
