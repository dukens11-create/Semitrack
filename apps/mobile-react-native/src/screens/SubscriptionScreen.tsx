import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import type { Services } from '../app/services';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverPage,
  DriverTitle,
  useDriverPalette,
} from '../components/DriverUI';
import { useStore } from '../hooks/useStore';
import {
  eligibilityCopy,
  subscriptionAccountSchema,
  subscriptionAdapter,
  createSubscriptionPricing,
  defaultSubscriptionPrices,
  publishedPricingSchema,
  type SubscriptionAccount,
} from '../features/subscriptions/SubscriptionService';

const price = (cents: number) => '$' + (cents / 100).toFixed(2);
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : 'Unavailable';

export function SubscriptionScreen({ services }: { services: Services }) {
  const p = useDriverPalette();
  const [published, setPublished] = useState<ReturnType<
    typeof publishedPricingSchema.parse
  > | null>(null);
  const pricing = createSubscriptionPricing(
    published?.prices ?? defaultSubscriptionPrices,
  );
  const userId = useStore(services.auth).user?.id;
  const adapter = useMemo(() => subscriptionAdapter(Platform.OS), []);
  const [loaded, setLoaded] = useState<{
    owner: string;
    account: SubscriptionAccount;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void services.api
      .request('GET', '/subscription-offers')
      .then(v => {
        const parsed = publishedPricingSchema.parse(v);
        if (current) setPublished(parsed);
      })
      .catch(() => {
        if (current) setPublished(null);
      });
    return () => {
      current = false;
    };
  }, [services, refresh]);
  const account = loaded && loaded.owner === userId ? loaded.account : null;
  useEffect(() => {
    let current = true;
    setLoaded(null);
    setLoading(true);
    setError('');
    if (!userId) {
      setLoading(false);
      return;
    }
    void services.api
      .request('GET', '/subscription-offers/account')
      .then(value => {
        const parsed = subscriptionAccountSchema.parse(value);
        if (current && services.auth.getSnapshot().user?.id === userId)
          setLoaded({ owner: userId, account: parsed });
      })
      .catch(() => {
        if (current)
          setError(
            'Account billing details are unavailable. Please retry later.',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [services, userId, refresh]);
  const eligibility = account?.monthlyEligibility ?? 'unknown';
  async function manage(provider: string) {
    try {
      await adapter.manage(provider);
    } catch {
      setError(
        'Could not open subscription management. Use the original store account.',
      );
    }
  }
  return (
    <DriverPage>
      <DriverTitle>Plans & Subscription</DriverTitle>
      <DriverCopy>
        {published
          ? `Published prices · version ${published.version}`
          : 'Reference prices — latest pricing unavailable. Refresh to check.'}
      </DriverCopy>
      <DriverCopy>
        Choose the plan that fits your work. Prices shown in USD. Offers are
        subject to store configuration and verified eligibility.
      </DriverCopy>
      <DriverCard>
        <DriverTitle small>Your subscription</DriverTitle>
        <DriverCopy>
          {loading
            ? 'Loading account details…'
            : !account
            ? 'Subscription status unavailable'
            : !account.subscriptions.length
            ? 'No verified subscription record available'
            : 'Latest verified subscription records'}
        </DriverCopy>
        {account?.subscriptions.map((record, index) => (
          <View key={index} style={styles.record}>
            <Text style={[styles.plan, { color: p.text }]}>
              Current plan record: {record.plan}
            </Text>
            <DriverCopy>
              Provider: {record.provider} · Status: {record.status}
            </DriverCopy>
            {(record.accessSuspended || record.paymentAccessBlocked) && (
              <DriverCopy>
                Subscription access suspended for payment review. Use the
                original provider to resolve payment.
              </DriverCopy>
            )}
            {record.gracePeriodEnd && (
              <DriverCopy>
                Verified grace period ends: {date(record.gracePeriodEnd)}
              </DriverCopy>
            )}
            {record.environment !== 'PRODUCTION' && (
              <DriverCopy>
                Test billing record — not a production subscription
              </DriverCopy>
            )}
            <DriverCopy>Last verified: {date(record.verifiedAt)}</DriverCopy>
            <DriverCopy>
              Trial status:{' '}
              {record.status === 'TRIALING'
                ? 'Trialing at last verification'
                : 'Not reported as trialing'}{' '}
              · Trial end: {date(record.trialEnd)}
            </DriverCopy>
            <DriverCopy>
              Promotion: {record.promotionStatus} · Paid promotional months
              remaining: {record.promotionalPeriodsRemaining ?? 'Unavailable'}
            </DriverCopy>
            <DriverCopy>
              Next billing price:{' '}
              {record.nextBillingCents !== null && record.nextBillingCurrency
                ? `${record.nextBillingCurrency} ${(
                    record.nextBillingCents / 100
                  ).toFixed(2)}`
                : 'Unavailable'}
            </DriverCopy>
            <DriverCopy>
              Next renewal: {date(record.nextRenewalAt)} · Current period ends:{' '}
              {date(record.currentPeriodEnd)}
            </DriverCopy>
            {record.cancelAtPeriodEnd && (
              <DriverCopy>Cancellation scheduled at period end</DriverCopy>
            )}
            <DriverButton
              title="Manage subscription"
              secondary
              disabled={
                record.provider !== adapter.provider ||
                record.environment !== 'PRODUCTION'
              }
              onPress={() => {
                void manage(record.provider);
              }}
            />
            {record.provider !== adapter.provider && (
              <DriverCopy>
                Manage with the original billing provider. In-app web checkout
                is unavailable.
              </DriverCopy>
            )}
          </View>
        ))}
        <DriverCopy>{eligibilityCopy[eligibility]}</DriverCopy>
        {adapter.provider && (
          <>
            <DriverButton
              title="Restore purchases"
              secondary
              disabled={!adapter.canRestore}
              onPress={() => {
                void adapter
                  .restore()
                  .catch(() =>
                    setError(
                      'Store restore is not configured. No access was changed.',
                    ),
                  );
              }}
            />
            <DriverCopy>
              Restore requires the original store account and verified receipts.
              It is not available in this build.
            </DriverCopy>
          </>
        )}
        <DriverButton
          title="Refresh subscription details"
          secondary
          disabled={loading}
          onPress={() => setRefresh(value => value + 1)}
        />
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: p.danger }}>
            {error}
          </Text>
        )}
      </DriverCard>
      <DriverCard>
        <DriverTitle small>SEMITRAX PREMIUM MONTHLY</DriverTitle>
        <Text style={[styles.badge, { color: p.actionText }]}>
          14 DAYS FREE
        </Text>
        <Text style={[styles.price, { color: p.text }]}>
          {price(pricing.monthly.introCents)}/month
        </Text>
        <DriverCopy>
          for first 3 paid months · Then {price(pricing.monthly.regularCents)}
          /month
        </DriverCopy>
        <DriverCopy>{pricing.monthly.summary}</DriverCopy>
        <DriverCopy>
          For eligible individual customers only. One welcome offer per
          customer; offers cannot be combined.
        </DriverCopy>
        <DriverCopy>{pricing.monthly.renewal}</DriverCopy>
        <DriverButton
          title="Start Free Trial"
          disabled={!adapter.canPurchase}
          onPress={() => {
            void adapter
              .purchase('monthly')
              .catch(() =>
                setError(
                  'Purchases are unavailable. No subscription was activated.',
                ),
              );
          }}
        />
        <DriverCopy>
          Store activation pending · No payment will be taken in this build.
        </DriverCopy>
      </DriverCard>
      <DriverCard>
        <DriverTitle small>SEMITRAX PREMIUM ANNUAL</DriverTitle>
        <Text style={[styles.badge, { color: p.actionText }]}>
          14 DAYS FREE
        </Text>
        <Text style={[styles.price, { color: p.text }]}>
          {price(pricing.annual.priceCents)}/year
        </Text>
        <DriverCopy>
          Approx. {price(pricing.annual.priceCents / 12)}/month for comparison
          only. Billed annually.
        </DriverCopy>
        <DriverCopy>{pricing.annual.summary}</DriverCopy>
        <DriverCopy>
          Trial subject to verified eligibility. No monthly introductory
          discount applies.
        </DriverCopy>
        <DriverCopy>{pricing.annual.renewal}</DriverCopy>
        <DriverButton
          title="Start Free Trial"
          disabled={!adapter.canPurchase}
          onPress={() => {
            void adapter
              .purchase('annual')
              .catch(() =>
                setError(
                  'Purchases are unavailable. No subscription was activated.',
                ),
              );
          }}
        />
        <DriverCopy>
          Store activation pending · No payment will be taken in this build.
        </DriverCopy>
      </DriverCard>
      <DriverCard>
        <DriverTitle small>SEMITRAX FLEET</DriverTitle>
        <DriverCopy>
          Fleet plans from{' '}
          {price((published?.prices ?? defaultSubscriptionPrices).fleet100)} per
          driver/month. Volume discounts available.
        </DriverCopy>
        {pricing.fleet.map(tier => (
          <View key={tier.min} style={[styles.tier, { borderColor: p.border }]}>
            <Text style={[styles.plan, { color: p.text }]}>{tier.label}</Text>
            <DriverCopy>
              {tier.cents === null
                ? 'Contact Sales for enterprise pricing.'
                : `${price(tier.cents)} / driver / month`}
            </DriverCopy>
          </View>
        ))}
        <DriverCopy>
          Existing subscriptions retain their agreed pricing. Fleet billing
          requires an approved agreement.
        </DriverCopy>
        <DriverCopy>{pricing.salesEmail}</DriverCopy>
        <DriverButton
          title="Contact Sales"
          secondary
          onPress={() => {
            void Linking.openURL(
              'mailto:contact@semitrax.com?subject=SemiTraX%20Fleet%20Subscription',
            ).catch(() =>
              setError('Email contact@semitrax.com for fleet pricing.'),
            );
          }}
        />
      </DriverCard>
      <DriverCopy>
        Subscriptions do not bypass truck restrictions or CoPilot licensing,
        maps and provisioning requirements.
      </DriverCopy>
    </DriverPage>
  );
}
const styles = StyleSheet.create({
  price: { fontSize: 30, fontWeight: '800' },
  badge: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  plan: { fontSize: 15, fontWeight: '700' },
  record: { gap: 10, paddingVertical: 8 },
  tier: {
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
