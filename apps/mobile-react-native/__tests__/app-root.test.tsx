jest.mock('../src/features/settings/AppearanceStorage', () => ({
  readAppearance: jest.fn().mockResolvedValue('day'),
}));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, StatusBar } from 'react-native';
import { AppRoot } from '../src/app/AppRoot';
import { createServices } from '../src/app/services';

jest.mock('../src/config/generated', () => ({
  apiUrl: '',
  mapboxToken: '',
  configurationDiagnostics: false,
}));
jest.mock('../src/app/services', () => ({ createServices: jest.fn() }));
jest.mock('../src/components/CopilotStatus', () => ({
  CopilotStatus: () => null,
}));
jest.mock('../src/navigation/AppNavigator', () => ({
  AppNavigator: () => null,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaProvider: View, SafeAreaView: View };
});

test('branding restoration preserves the missing API configuration guard', async () => {
  let screen!: ReactTestRenderer;
  await act(async () => {
    screen = create(<AppRoot />);
  });
  const content = screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .join(' ');
  expect(content).toContain('Configuration required');
  expect(createServices).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});

test.each(['day', 'night'] as const)(
  '%s root controls the status bar even on configuration errors',
  async mode => {
    const {
      readAppearance,
    } = require('../src/features/settings/AppearanceStorage');
    readAppearance.mockResolvedValue(mode);
    let screen!: ReactTestRenderer;
    await act(async () => {
      screen = create(<AppRoot />);
    });
    const status = screen.root.findByType(StatusBar);
    expect(status.props.barStyle).toBe(
      mode === 'day' ? 'dark-content' : 'light-content',
    );
    expect(status.props.backgroundColor).toBe(
      mode === 'day' ? '#F3F5F7' : '#0C131B',
    );
    await act(async () => screen.unmount());
  },
);
