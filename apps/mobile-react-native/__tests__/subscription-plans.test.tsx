import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Text, StyleSheet } from 'react-native';
import { SubscriptionScreen } from '../src/screens/SubscriptionScreen';
import {
  subscriptionAccountSchema,
  defaultSubscriptionPrices,
  subscriptionAdapter,
  type SubscriptionAccount,
} from '../src/features/subscriptions/SubscriptionService';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import { user, deferred } from './fixtures';

const empty: SubscriptionAccount = {
  subscriptions: [],
  monthlyEligibility: 'provider_not_configured',
  purchaseAvailable: false,
};
const record: SubscriptionAccount['subscriptions'][number] = {
  plan: 'GOLD',
  status: 'ACTIVE',
  provider: 'APPLE',
  environment: 'PRODUCTION',
  trialEnd: null,
  currentPeriodEnd: '2026-10-19T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  verifiedAt: '2026-09-19T00:00:00.000Z',
  nextBillingCents: null,
  nextBillingCurrency: null,
  nextRenewalAt: null,
  promotionStatus: 'unknown',
  promotionalPeriodsRemaining: null,
};
let screen: ReactTestRenderer;
const content = () =>
  screen.root
    .findAllByType(Text)
    .flatMap(n => [n.props.children].flat(Infinity))
    .join('');
const button = (title: string) =>
  screen.root.findAll(
    n =>
      n.props.accessibilityLabel === title &&
      typeof n.props.onPress === 'function',
  )[0]!;
async function setup(
  value: unknown = empty,
  mode: 'day' | 'night' = 'day',
  catalog: unknown = { version: 1, prices: defaultSubscriptionPrices },
) {
  const request = jest
    .fn()
    .mockImplementation((_method: string, path: string) =>
      Promise.resolve(path === '/subscription-offers' ? catalog : value),
    );
  const auth = new Store({ user });
  const services = { auth, api: { request } } as unknown as Services;
  await act(async () => {
    screen = create(
      <DriverAppearanceContext.Provider value={mode}>
        <SubscriptionScreen services={services} />
      </DriverAppearanceContext.Provider>,
    );
  });
  return { request, services };
}
beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.restoreAllMocks();
});
test.each(['day', 'night'] as const)(
  'approved monthly and annual terms remain visible in %s',
  async mode => {
    await setup(empty, mode);
    for (const text of [
      '$14.99/month',
      'first 3 paid months',
      '$19.99/month',
      '14 DAYS FREE',
      '$199.99/year',
      'Billed annually.',
      'automatically renews',
    ])
      expect(content()).toContain(text);
    expect(content()).not.toContain('$9.99');
    expect(content()).not.toContain('7 days');
    const title = screen.root
      .findAllByType(Text)
      .find(n => n.props.children === 'Plans & Subscription')!;
    expect(StyleSheet.flatten(title.props.style).color).toBe(
      mode === 'day' ? '#101820' : '#FFFFFF',
    );
  },
);
test.each([
  ['1–4 drivers', '$19.99'],
  ['5–24 drivers', '$17.99'],
  ['25–99 drivers', '$15.99'],
  ['100–249 drivers', '$13.99'],
  ['250+ drivers', 'Contact Sales for enterprise pricing.'],
])('fleet %s pricing', async (label, amount) => {
  await setup();
  expect(content()).toContain(label);
  expect(content()).toContain(amount);
});
test('trial buttons remain disabled even if account eligibility says eligible', async () => {
  const { request } = await setup({ ...empty, monthlyEligibility: 'eligible' });
  const buttons = screen.root.findAll(
    n => n.props.accessibilityLabel === 'Start Free Trial',
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons)
    expect(b.props.accessibilityState.disabled).toBe(true);
  expect(request.mock.calls).toHaveLength(2);
  expect(request.mock.calls).toEqual(
    expect.arrayContaining([
      ['GET', '/subscription-offers/account'],
      ['GET', '/subscription-offers'],
    ]),
  );
});
test.each([
  ['already_used', 'cannot be claimed again'],
  ['fleet_account', 'fleet agreement'],
  ['unknown', 'eligibility is unavailable'],
  ['provider_not_configured', 'not available yet'],
])('eligibility %s is explicit', async (eligibility, text) => {
  await setup({ ...empty, monthlyEligibility: eligibility });
  expect(content()).toContain(text);
});
test('current record uses verified values and never derives the next invoice from catalog', async () => {
  await setup({ ...empty, subscriptions: [record] });
  expect(content()).toContain('Current plan record: GOLD');
  expect(content()).toContain('Next billing price: Unavailable');
  expect(content()).toContain('Paid promotional months remaining: Unavailable');
});
test('server-provided renewal and remaining periods are displayed when available', async () => {
  await setup({
    ...empty,
    subscriptions: [
      {
        ...record,
        nextBillingCents: 1499,
        nextBillingCurrency: 'USD',
        nextRenewalAt: '2026-10-19T00:00:00.000Z',
        promotionStatus: 'active',
        promotionalPeriodsRemaining: 2,
      },
    ],
  });
  expect(content()).toContain('Next billing price: USD 14.99');
  expect(content()).toContain('Paid promotional months remaining: 2');
});
test('unconfigured restore cannot produce activation', async () => {
  await setup();
  expect(button('Restore purchases').props.accessibilityState.disabled).toBe(
    true,
  );
  await expect(subscriptionAdapter('ios').restore()).rejects.toThrow(
    'unavailable',
  );
});
test.each([
  [
    'android',
    'GOOGLE_PLAY',
    'https://play.google.com/store/account/subscriptions',
  ],
  ['ios', 'APPLE', 'https://apps.apple.com/account/subscriptions'],
])('%s manages only its original provider', async (platform, provider, url) => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const adapter = subscriptionAdapter(platform);
  expect(adapter.provider).toBe(provider);
  await adapter.manage(provider);
  expect(open).toHaveBeenCalledWith(url);
  await expect(adapter.manage('STRIPE')).rejects.toThrow('original');
  expect(open).toHaveBeenCalledTimes(1);
  for (const plan of ['monthly', 'annual'] as const)
    await expect(adapter.purchase(plan)).rejects.toThrow('unavailable');
});
test('manage action uses the platform store and no backend mutation', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const { request } = await setup({ ...empty, subscriptions: [record] });
  await act(async () => button('Manage subscription').props.onPress());
  expect(open).toHaveBeenCalledWith(
    'https://apps.apple.com/account/subscriptions',
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(call => call[0] === 'GET')).toBe(true);
});
test('unknown platform cannot initiate Stripe checkout or native purchases', async () => {
  const a = subscriptionAdapter('web');
  expect(a.provider).toBe(null);
  await expect(a.purchase('monthly')).rejects.toThrow('unavailable');
  await expect(a.manage('STRIPE')).rejects.toThrow('original');
});
test('invalid or fabricated purchase availability is rejected by the account contract', () => {
  expect(
    subscriptionAccountSchema.safeParse({
      ...empty,
      purchaseAvailable: true,
      premium: true,
    }).success,
  ).toBe(false);
  expect(
    subscriptionAccountSchema.parse({ ...empty, premium: true }),
  ).not.toHaveProperty('premium');
});
test('backend errors show unavailable and never pretend the account is free or paid', async () => {
  await setup({ broken: true });
  expect(content()).toContain('Subscription status unavailable');
  expect(content()).not.toContain('Current plan record:');
});
test('an account change prevents an older response from revealing the previous account', async () => {
  const pending = deferred<unknown>();
  class Auth extends Store<{ user: typeof user }> {
    switchUser() {
      this.publish({ user: { ...user, id: 'other' } });
    }
  }
  const auth = new Auth({ user });
  let accountReads = 0;
  const request = jest
    .fn()
    .mockImplementation((_method: string, path: string) =>
      path === '/subscription-offers'
        ? Promise.resolve({ version: 1, prices: defaultSubscriptionPrices })
        : accountReads++ === 0
        ? pending.promise
        : Promise.resolve(empty),
    );
  const services = { auth, api: { request } } as unknown as Services;
  await act(async () => {
    screen = create(<SubscriptionScreen services={services} />);
  });
  await act(async () => auth.switchUser());
  await act(async () => pending.resolve({ ...empty, subscriptions: [record] }));
  expect(content()).not.toContain('GOLD');
  expect(content()).toContain('No verified subscription record');
});

test('historical pilot records remain readable without enabling store checkout', async () => {
  await setup({ ...empty, subscriptions: [{ ...record, provider: 'PILOT' }] });
  expect(content()).toContain('Provider: PILOT');
  expect(button('Manage subscription').props.accessibilityState.disabled).toBe(
    true,
  );
  expect(content()).toContain('original billing provider');
});

test('published Admin prices replace every offer without changing verified renewal values', async () => {
  await setup(
    {
      ...empty,
      subscriptions: [
        { ...record, nextBillingCents: 999, nextBillingCurrency: 'USD' },
      ],
    },
    'day',
    {
      version: 8,
      prices: {
        ...defaultSubscriptionPrices,
        monthlyRegular: 2499,
        monthlyIntro: 1699,
        annual: 24999,
        fleet1: 2499,
        fleet5: 2199,
        fleet25: 1899,
        fleet100: 1599,
      },
    },
  );
  for (const text of [
    'version 8',
    '$24.99/month',
    '$16.99/month',
    '$249.99/year',
    '$21.99',
    '$18.99',
    '$15.99',
    'Next billing price: USD 9.99',
  ])
    expect(content()).toContain(text);
  expect(content()).not.toContain('$19.99/month');
});
test.each([
  { broken: true },
  { version: 2, prices: { ...defaultSubscriptionPrices, monthlyRegular: -1 } },
])('invalid published prices are labeled reference-only', async catalog => {
  await setup(empty, 'day', catalog);
  expect(content()).toContain('Reference prices');
  expect(content()).not.toContain('Published prices');
});
test('verified hold and grace facts are displayed without granting purchase access', async () => {
  await setup({
    ...empty,
    subscriptions: [
      {
        ...record,
        status: 'PAST_DUE',
        accessSuspended: true,
        paymentAccessBlocked: true,
        gracePeriodEnd: '2026-09-18T00:00:00.000Z',
      },
    ],
  });
  expect(content()).toContain('suspended');
  expect(button('Start Free Trial').props.accessibilityState.disabled).toBe(
    true,
  );
});
