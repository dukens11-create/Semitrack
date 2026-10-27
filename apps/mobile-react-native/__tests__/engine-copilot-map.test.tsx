import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { EngineCopilotMap } from '../src/features/map/EngineCopilotMap';
import { CopilotOfflineMap } from '../src/components/CopilotOfflineMap';
const mockCommand = jest.fn();
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => ({ mapCommand: mockCommand }),
}));
jest.mock('../src/services/copilot/CopilotProvider', () => ({
  useCopilotState: () => ({ initialized: true }),
}));
jest.mock('../src/components/CopilotOfflineMap', () => ({
  CopilotOfflineMap: () => null,
}));
jest.mock('../src/components/CoPilotVoiceControls', () => ({
  CoPilotVoiceControls: () => null,
}));
jest.mock('../src/features/map/useEngineMapSnapshot', () => ({
  useEngineMapSnapshot: () => ({ sample: null, now: 0 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
let tree: ReactTestRenderer;
beforeEach(() => {
  mockCommand.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
});
test('mounts the native map only after display setup and forwards camera controls', async () => {
  let finish!: () => void;
  mockCommand.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    tree = create(<EngineCopilotMap onClose={() => {}} />);
  });
  expect(tree.root.findAllByType(CopilotOfflineMap)).toHaveLength(0);
  expect(mockCommand).toHaveBeenCalledWith('embedded-navigation');
  await act(async () => {
    finish();
  });
  expect(tree.root.findAllByType(CopilotOfflineMap)).toHaveLength(1);
  for (const [label, command] of [
    ['Zoom in', 'zoom-in'],
    ['Zoom out', 'zoom-out'],
    ['Compass north up', 'north-up'],
    ['Follow truck', 'recenter'],
  ]) {
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: label }).props.onPress();
    });
    expect(mockCommand).toHaveBeenLastCalledWith(command);
  }
  expect(mockCommand).not.toHaveBeenCalledWith('native-map');
});
test('failed display setup leaves the renderer unmounted and explains recovery', async () => {
  mockCommand.mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => {
    tree = create(<EngineCopilotMap onClose={() => {}} />);
  });
  expect(tree.root.findAllByType(CopilotOfflineMap)).toHaveLength(0);
  expect(
    tree.root
      .findAllByType(Text)
      .some(x => String(x.props.children).includes('Open Trip controls')),
  ).toBe(true);
});
