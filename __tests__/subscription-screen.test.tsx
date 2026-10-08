import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import type { Services } from '../src/app/services';
import { SubscriptionScreen } from '../src/screens/SubscriptionScreen';
import { ApiError } from '../src/services/api/ApiClient';
import { Store } from '../src/state/Store';
import { user } from './fixtures';

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

let screen: ReactTestRenderer;

function content() {
  return screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
}

function servicesWith(request: jest.Mock) {
  return {
    auth: new Store({ status: 'signedIn', user }),
    api: { request },
  } as unknown as Services;
}

afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.clearAllMocks();
});

test('subscription access is read-only and uses only the existing entitlement GET', async () => {
  const request = jest.fn().mockResolvedValue({ accessState: 'ACTIVE' });
  const services = servicesWith(request);

  await act(async () => {
    screen = create(<SubscriptionScreen services={services} />);
  });

  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('GET', '/entitlements');
  expect(content()).toContain('Plan: FREE');
  expect(content()).toContain('Access state: ACTIVE');
  expect(content()).toContain('does not purchase, renew, cancel or change');
  expect(request.mock.calls.every(call => call[0] === 'GET')).toBe(true);
});

test('subscription access reports billing-disabled without inventing availability', async () => {
  const request = jest
    .fn()
    .mockRejectedValue(new ApiError('BILLING_DISABLED', 'Billing disabled.'));
  const services = servicesWith(request);

  await act(async () => {
    screen = create(<SubscriptionScreen services={services} />);
  });

  expect(request).toHaveBeenCalledWith('GET', '/entitlements');
  expect(content()).toContain('Billing is disabled in this build.');
  expect(content()).not.toContain('Subscribe now');
  expect(content()).not.toContain('$');
});
