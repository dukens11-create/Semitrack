# Semi-Trax subscription Phase 2 foundation

Phase 2 adds the backend and database foundation only. Google Play Billing, Apple In-App Purchase, Stripe Checkout, real charges, and provider webhook endpoints are not activated.

## Safety mode

`BILLING_MODE` defaults to `disabled`. All active subscription-plan, entitlement, pilot, administrative subscription, and `/billing/*` endpoints return HTTP 503 with the stable `BILLING_DISABLED` code while disabled. No billing route performs authentication, database work, or provider work in that state. Non-billing routes continue to operate normally.

Stripe credentials and destination URLs may remain empty while billing is disabled. Starting with `BILLING_MODE=test` requires non-empty test credentials, an exact HTTPS origin allowlist, and public HTTPS success, cancellation, and portal-return URLs whose origins are on that allowlist. Live Stripe secret keys are rejected. No production mode exists yet, which prevents accidental live billing activation.

`STRIPE_AUTOMATIC_TAX_ENABLED` must remain `false`. Startup rejects `true` in every Phase 2 mode. Tax registration, nexus obligations, and Stripe Tax account settings require a separate production approval.

The API validates these numeric settings on every startup:

- `STRIPE_TRIAL_DAYS` and `STRIPE_GRACE_PERIOD_DAYS`: integers greater than or equal to zero
- `PILOT_MAX_REDEMPTIONS`: integer from 1 through the approved maximum of 100
- `PILOT_DISCOUNT_MONTHS`: positive integer
- `PILOT_RESERVATION_MINUTES`: positive integer

`STRIPE_ALLOWED_WEB_ORIGINS` is a comma-separated collection of canonical HTTPS origins, for example `https://www.semitrax.com`. Wildcards, paths, queries, credentials, fragments, HTTP origins, and trailing slashes are rejected. Request origins are compared by exact string equality.

## Catalog and provider identifiers

The database catalog stores planning prices in cents for administration and tests. Google Play and Apple localized store prices will be authoritative in the mobile UI when store billing is implemented.

- Individual monthly: USD 19.99 with a seven-day eligible trial
- Individual annual: USD 199.99 with a seven-day eligible trial
- Founding 100 pilot: USD 9.99/month for six months, no additional trial
- Fleet 1–4: USD 19.99/driver/month
- Fleet 5–24: USD 17.99/driver/month
- Fleet 25–99: USD 15.99/driver/month
- Fleet 100+: sales-assisted custom contract

Configured store identifiers:

- Google Play product `semitrax_premium`
- Google Play base plans `monthly` and `annual`
- Google Play trial offer `trial_7_day`
- Apple group `Semi-Trax Premium`
- Apple products `com.semitrax.premium.monthly` and `com.semitrax.premium.annual`

These are documented placeholders only. They are not created in either store by this phase.

## Unified entitlement model

Billing records and access are separate:

- `Subscription` stores provider billing lifecycle facts.
- `EntitlementSource` stores normalized access sources from Google Play, Apple, Stripe, pilot billing, fleet seats, or an administrative grant.
- `EntitlementSnapshot` has one row per user and entitlement code. It derives one effective `PREMIUM_NAVIGATION` result even when several records exist.
- Trialing, active, grace-period, billing-retry, and cancel-at-period-end sources may grant access only through their explicit access window.
- Paused, past-due, canceled, expired, refunded, and revoked sources do not grant access.
- `SubscriptionOfferRedemption` has a unique `(userId, eligibilityGroup)` constraint. The `WELCOME_OFFER` group prevents stacking a regular trial, pilot discount, introductory offer, or duplicate promotion.

The existing `GET /entitlements` endpoint now returns the server-derived result and a bounded cache expiration. Navigation routes are deliberately not guarded in Phase 2.

The follow-up compatibility migration backfills recognized pre-Phase-2 subscription providers into entitlement sources. Unknown legacy provider labels are left for manual review rather than being silently assigned to an incorrect provider.

Verified Stripe failed-payment events use the configured three-day grace window. Premium access may continue only until that explicit deadline; if payment has not recovered, the existing entitlement calculation stops granting access. A later verified successful provider event may restore it.

## Pilot workflow

Only an authenticated `ADMIN` can approve, mark delivered, revoke, or change the pilot campaign state.

1. `POST /admin/pilot/invitations` creates a cryptographically random token.
2. The plain token is returned once. Only its SHA-256 digest is stored.
3. Approval reserves a campaign slot under a PostgreSQL row lock.
4. Expired or revoked unredeemed invitations release their reservation.
5. A redeemed slot is permanently counted, including if the invitation is later revoked.
6. `POST /pilot/invitations/redeem` requires the authenticated account to match the assigned user/email and atomically claims its unique `WELCOME_OFFER` record.
7. Invitation redemption records eligibility only. It does not create paid entitlement without a future verified billing-provider purchase.

The `PilotCampaign` database constraint enforces `reservedCount + redeemedCount <= redemptionLimit`, and the campaign is seeded with a maximum limit of 100.

Pilot subscriptions are explicitly incompatible with `TRIALING`, `trialStart`, or `trialEnd`. The USD 9.99 six-month price is the complete introductory benefit and can never be combined with the regular seven-day trial.

## Fleet seat foundation

- `FleetBillingAccount` stores the provider customer/subscription/price references, current and pending seat quantities, provider verification time, and billing period.
- `FleetMembership` identifies owners, billing administrators, and drivers, including which active members require paid seats.
- `FleetSeatChange` records the requesting user, old and requested quantities, required assigned-seat count, Stripe request/event references, expected invoice impact, proration behavior, effective date, outcome, and failure metadata.
- Increases use Stripe proration and remain `AWAITING_PROVIDER`; seats cannot be granted until the provider accepts the update.
- Decreases retain the currently paid seats and are scheduled for the current period end. The requested quantity cannot fall below required assigned seats.
- The API exposes no fleet-billing mutation endpoint in Phase 2. Authorization checks and Stripe operations are Phase 3 work.

## Verified refund foundation

`BillingRefund` records the provider refund/event IDs, amount, currency, reason, related user/subscription/payment, verified disposition, and any administrator review/action. Duplicate provider refund and event IDs are rejected.

- Partial refund: retain access automatically.
- Full refund without verified cancellation/revocation: retain access, flag for administrator review, and resynchronize with Stripe.
- Full refund with verified cancellation/revocation: revoke only after the verified provider event is applied.
- Client-provided refund state is never authoritative.

## Foundation endpoints

- `GET /entitlements`
- `GET /pilot/eligibility`
- `POST /pilot/invitations/redeem`
- `GET /admin/pilot/invitations`
- `POST /admin/pilot/invitations`
- `POST /admin/pilot/invitations/:id/delivered`
- `POST /admin/pilot/invitations/:id/revoke`
- `PATCH /admin/pilot/campaigns/:code`
- `POST /admin/entitlements/grants`
- `POST /admin/entitlements/grants/:id/revoke`
- `GET /admin/entitlements/users/:userId`

All endpoints in this section return `BILLING_DISABLED` while `BILLING_MODE=disabled`. When test mode is later enabled, read endpoints require the documented user or administrator authentication and mutation endpoints additionally require `BILLING_MODE=test`. Token hashes are never returned by list/read operations.

## Provider-event foundation

`ProviderEvent` stores a unique `(provider, providerEventId)`, SHA-256 payload digest, lifecycle status, attempt count, provider timestamp, and safe error metadata. The service can atomically register, claim, complete, ignore, or fail an event. Provider-specific signature verification and webhook routes remain deliberately absent until their provider phases; an unauthenticated webhook is not exposed.

## Configuration still required

- Permanent public API URL and resolved provider webhook URLs
- Confirmation of permanent Android/iOS application identifiers
- Google Play Console application, service account, and Pub/Sub resources
- Apple Developer/App Store Connect app, team, issuer, key, and private key
- Stripe test account, webhook signing secret, products, prices, portal configuration, and website return URLs
- Deployment secret-manager entries for every private credential
- Google Play license testers and Apple sandbox testers (never tester passwords)

The custom-domain legal URLs must not be submitted to app stores until their HTTPS certificate, homepage, Privacy Policy, and Terms of Service have been verified. Stripe billing must also remain disabled until the configured checkout-success, checkout-cancel, and portal-return pages exist and `https://www.semitrax.com` has a valid certificate. This is an operational verification; startup validation deliberately does not make outbound network calls. Keep `https://semitrax-website.onrender.com` available as the temporary fallback.

The planned Stripe test-mode setup and six-price checklist are documented in `docs/STRIPE_PHASE3_TEST_SETUP.md`. No Stripe products or prices are created by Phase 2.
