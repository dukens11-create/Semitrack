# SemiTraX approved subscription pricing

Approved 2026-09-19. The initial planning defaults are in `apps/api/src/contracts/subscriptionPricing.ts`, shared by the API and React Native. Published display prices are now versioned in `SubscriptionPricingConfig` and editable by Admin; the table below records the initial approved defaults. Prices are USD. Billing remains disabled; these offers do not grant access.

| Plan | Trial | Paid price | Renewal |
| --- | --- | --- | --- |
| Individual monthly | 14 days, eligible customers | $14.99/month for exactly 3 paid periods after the trial | $19.99/month from paid period 4 |
| Individual annual | 14 days, eligible customers | $199.99/year | $199.99/year |
| Fleet 1–4 | Contract dependent | $19.99/driver/month | Contract dependent |
| Fleet 5–24 | Contract dependent | $17.99/driver/month | Contract dependent |
| Fleet 25–99 | Contract dependent | $15.99/driver/month | Contract dependent |
| Fleet 100–249 | Contract dependent | $13.99/driver/month | Contract dependent |
| Fleet 250+ | Contract dependent | Contact Sales for enterprise pricing. | Negotiated |

Monthly: **14 days free. Then $14.99/month for your first 3 months. After that, $19.99/month until canceled.**

Your subscription automatically renews at $19.99/month after the introductory period unless canceled before renewal.

Annual: **14 days free. Then $199.99/year.** Your subscription automatically renews at $199.99/year unless canceled before renewal. Approx. $16.67/month is comparison only; the billing cadence is annual. Annual has no monthly introductory discount.

Fleet plans from $13.99 per driver/month. Volume discounts available. The $13.99 tier requires 100–249 drivers. Contact: contact@semitrax.com.

## App and API

More → Plans & Subscription, or More → Account and settings → Plans & Subscription. Shared Day/Night palette and existing native stack/back navigation apply.

GET /subscription-offers exposes the approved read-only planning catalog without activating billing. GET /subscription-offers/account requires the current authenticated account and returns only its verified subscription records, labeled with billing environment and verification time. No raw events, provider account identifiers or receipts are exposed. Unknown next invoice, renewal, promotional status and remaining paid periods remain unavailable; current-period end/price is not treated as a next-invoice quote.

The existing billing-gated GET /subscription-plans now presents the approved planning offers when enabled, with isActive=false. The administrative database catalog retains historical records. Its historical edits do not override the published offer catalog. Admin → Plans & pricing now edits the versioned public display prices with a confirmation, reason and audit entry. Migration `20260919030000_subscription_admin_controls` adds the display-price singleton and per-subscription access holds. The mobile screen loads the current published prices and labels fallback values as reference prices if unavailable. Store products, actual invoices and existing agreements remain provider-controlled.

## Eligibility and lifecycle

WELCOME_OFFER remains unique per account. The backend consults prior claims (including reserved/expired/revoked claims) and fleet membership. Unknown provider eligibility never becomes eligible. Annual selection is explicitly excluded from the monthly introduction. A verified renewal may continue the original offer, but a new subscription cannot reuse that claim, even for the same offer kind. Historical administrator-approved pilot invitations may attach once to their first verified Stripe subscription. No client request can claim or reset eligibility on the new read-only endpoints.

The pricing schedule helper consumes a paid-period number, not signup time. It is planning logic, not invoice creation. Production still requires provider-verified paid-period events, durable customer identity/rejoin protection across account deletion or a second account, and a supported store offer schedule. Do not infer 3 remaining periods merely from a trial start date. No client code grants entitlements.

## Provider readiness — not activated

- Android: Google Play only. Product semitrax_premium; base plans monthly/annual unchanged. The historical configured default trial_7_day remains unchanged and is NOT used for the new 14-day offer. New offer ID is null pending approved Console setup. Native purchase/restore bridge, server receipt verification and sandbox lifecycle acceptance remain required.
- iOS: StoreKit only. Products com.semitrax.premium.monthly and com.semitrax.premium.annual unchanged. New offer ID is null. Confirm a supported arrangement for the combined free trial followed by three discounted paid periods; do not assume one introductory offer supports both phases. StoreKit integration, server transaction verification and sandbox acceptance remain required.
- Web/approved fleet: Stripe only. New price IDs are null. No Stripe consumer checkout is exposed in the mobile app. Existing test-only foundation endpoints remain gated/unimplemented. Provider schedule, authenticated portal, signed webhook verification and controlled sandbox acceptance remain required.

Start Free Trial is visibly disabled in this build with a setup explanation. Restore is visibly unavailable, never simulated. Manage subscription opens only the platform's original official store for a production record. Cross-provider and test records cannot open a misleading management flow. Contact Sales opens the user's email composer, not checkout.

Official setup references: [Google subscription lifecycle and management](https://developer.android.com/google/play/billing/subscriptions), [Apple auto-renewable subscriptions](https://developer.apple.com/app-store/subscriptions/).

## Historical pricing and existing agreements

The Founding 100 $9.99/six-month/no-trial campaign, seven-day trial references, and prior 100+ sales tier in old migrations/audit reports are historical. They are not advertised to new users. Existing subscription prices and provider contracts are not mutated. The default for future Stripe planning is now 14 days; explicit existing environment configuration is not rewritten and must be reviewed before any activation. Historical database catalog, campaign and redemption rows remain for audit/grandfathering. Never silently reprice an existing contract from this catalog.

No live billing, store purchase, receipt submission, production database operation or provider call is part of this implementation. Payment does not bypass CoPilot provisioning or truck routing safeguards.
