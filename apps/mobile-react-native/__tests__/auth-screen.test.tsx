import { ApiError } from '../src/services/api/ApiClient';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput, Text, Image, Dimensions, StyleSheet } from 'react-native';
import { AuthScreen } from '../src/screens/AuthScreen';
import type { Services } from '../src/app/services';
import { deferred } from './fixtures';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

let screen: ReactTestRenderer;
const authenticate = jest.fn();
const requestPasswordReset = jest.fn();
const services = {
  auth: { authenticate, requestPasswordReset },
} as unknown as Services;
const input = (label: string) =>
  screen.root
    .findAllByType(TextInput)
    .find(node => node.props.accessibilityLabel === label)!;
const button = (label: string) =>
  screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0]!;
const text = () =>
  screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
async function press(label: string) {
  await act(async () => {
    button(label).props.onPress();
  });
}
async function fill(label: string, value: string) {
  await act(async () => {
    input(label).props.onChangeText(value);
  });
}
beforeEach(async () => {
  authenticate.mockReset().mockResolvedValue(undefined);
  requestPasswordReset.mockReset().mockResolvedValue(undefined);
  await act(async () => {
    screen = create(<AuthScreen services={services} />);
  });
});
afterEach(async () => {
  await act(async () => screen.unmount());
});

test('registration validates fields before requesting an account', async () => {
  await press('Create account mode');
  await fill('Full name', 'D');
  await fill('Email', 'invalid');
  await fill('Password', 'short');
  await press('Create account');
  expect(authenticate).not.toHaveBeenCalled();
  expect(text()).toContain('Enter your full name');
  expect(text()).toContain('Enter a valid email');
  expect(text()).toContain('Use at least 10 characters');
  await fill('Full name', 'Test Driver');
  await fill('Email', 'driver@example.test');
  await fill('Password', 'test-password');
  await press('Create account');
  expect(authenticate).toHaveBeenCalledWith(
    'driver@example.test',
    'test-password',
    'Test Driver',
  );
});

test('sign in permits existing shorter passwords and uses the existing login contract', async () => {
  await fill('Email', 'driver@example.test');
  await fill('Password', 'existing');
  await press('Sign in');
  expect(authenticate).toHaveBeenCalledWith(
    'driver@example.test',
    'existing',
    undefined,
  );
});

test('password visibility is reversible and mode switching obscures it again', async () => {
  expect(input('Password').props.secureTextEntry).toBe(true);
  await press('Show password');
  expect(input('Password').props.secureTextEntry).toBe(false);
  await press('Hide password');
  expect(input('Password').props.secureTextEntry).toBe(true);
  await press('Show password');
  await press('Create account mode');
  expect(input('Password').props.secureTextEntry).toBe(true);
});

test('in-flight submission prevents duplicate requests, edits and mode changes; errors allow retry', async () => {
  const pending = deferred<void>();
  authenticate.mockReturnValueOnce(pending.promise);
  await fill('Email', 'driver@example.test');
  await fill('Password', 'test-password');
  await press('Sign in');
  await press('Sign in');
  await press('Create account mode');
  expect(authenticate).toHaveBeenCalledTimes(1);
  expect(button('Sign in').props.disabled).toBe(true);
  expect(input('Email').props.editable).toBe(false);
  expect(screen.root.findAllByType(TextInput)).toHaveLength(2);
  await act(async () =>
    pending.reject(
      new ApiError('NETWORK_UNAVAILABLE', 'Untrusted network details'),
    ),
  );
  expect(text()).toContain('Unable to reach SemiTraX.');
  expect(button('Sign in').props.disabled).toBe(false);
  await press('Sign in');
  expect(authenticate).toHaveBeenCalledTimes(2);
});

test('forgot password validates email and does not promise unimplemented email delivery', async () => {
  await press('Forgot password?');
  expect(requestPasswordReset).not.toHaveBeenCalled();
  expect(text()).toContain('Enter your email first.');
  await fill('Email', 'driver@example.test');
  await press('Forgot password?');
  expect(requestPasswordReset).toHaveBeenCalledWith('driver@example.test');
  expect(text()).toContain('Recovery email delivery is not yet available.');
  expect(authenticate).not.toHaveBeenCalled();
});

test('failed recovery stays signed out and reports unavailability', async () => {
  requestPasswordReset.mockRejectedValueOnce(new Error('offline'));
  await fill('Email', 'driver@example.test');
  await press('Forgot password?');
  expect(text()).toContain('Password recovery is temporarily unavailable.');
  expect(authenticate).not.toHaveBeenCalled();
  expect(button('Sign in').props.disabled).toBe(false);
});


test.each([200, 240, 320, 412, 768, 1024])('logo overrides intrinsic artwork dimensions at viewport width %i', async width => {
 const originalWindow = Dimensions.get('window');
 const originalScreen = Dimensions.get('screen');
 try {
   await act(async () => Dimensions.set({ window: {...originalWindow, width}, screen: {...originalScreen, width} }));
   for (const mode of ['Sign in mode', 'Create account mode']) {
     await press(mode);
     const image = screen.root.findAllByType(Image).find(n => n.props.accessibilityLabel === 'Semi-TraX — Smarter routes. Safer deliveries.')!;
     const nativeStyle = StyleSheet.flatten([{width:1723,height:541}, image.props.style]);
     expect(typeof nativeStyle.width).toBe('number');
     expect(typeof nativeStyle.height).toBe('number');
     expect(nativeStyle.width).toBeLessThanOrEqual(188);
     expect(nativeStyle.width).toBeLessThanOrEqual(width - 52);
     expect(nativeStyle.height).toBeCloseTo(Number(nativeStyle.width) * 541 / 1723, 6);
     expect(image.props.resizeMode).toBe('contain');
     expect(image.props.source).toBe(require('../src/assets/semitrax_login_lockup.png'));
   }
 } finally {
   await act(async () => Dimensions.set({window:originalWindow,screen:originalScreen}));
 }
});
