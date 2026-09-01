# Stripe Phase 3 test-mode setup checklist

This is a preparation checklist only. Phase 2 does not create Stripe products, prices, customers, subscriptions, Checkout sessions, portal sessions, charges, or webhooks.

## Hard prerequisites

- Keep `BILLING_MODE=disabled` until Phase 3 is explicitly approved.
- Use a new Semi-Trax Stripe test account. Never reuse another business's products, prices, customers, or webhook endpoints.
- Do not paste secret keys or webhook secrets into source code, documentation, logs, chat, Flutter, or Git.
- Store private values in the deployment secret manager and local ignored `.env` file only.
- Confirm these pages exist and return successful HTTPS responses before enabling test Checkout:
  - `https://www.semitrax.com/billing/success`
  - `https://www.semitrax.com/billing/cancel`
  - `https://www.semitrax.com/account/billing`
- Confirm `https://www.semitrax.com` has a valid HTTPS certificate.
- Keep Stripe Tax disabled: `STRIPE_AUTOMATIC_TAX_ENABLED=false`.

## Six planned test prices

Create these later in the Semi-Trax Stripe Dashboard. Record the resulting IDs only in secret/configuration storage.

| Environment variable | Recurring price | Purpose |
| --- | ---: | --- |
| `STRIPE_PRICE_INDIVIDUAL_MONTHLY_ID` | $19.99/month | Individual web monthly |
| `STRIPE_PRICE_INDIVIDUAL_ANNUAL_ID` | $199.99/year | Individual web annual |
| `STRIPE_PRICE_PILOT_MONTHLY_ID` | $9.99/month | Approved pilot, first six months, no trial |
| `STRIPE_PRICE_FLEET_1_4_ID` | $19.99/unit/month | Fleet 1–4 |
| `STRIPE_PRICE_FLEET_5_24_ID` | $17.99/unit/month | Fleet 5–24 |
| `STRIPE_PRICE_FLEET_25_99_ID` | $15.99/unit/month | Fleet 25–99 |

Fleet 100+ has no self-service Stripe price. Direct those accounts to `contact@semitrax.com`.

## Dashboard work after Phase 3 approval

1. Create separate individual and fleet test products, plus the approved pilot test price.
2. Configure the pilot schedule to move from $9.99 to the regular $19.99 monthly price after six paid months, without a trial.
3. Configure the Customer Portal for payment methods, invoices, cancellation, and approved subscription changes.
4. Create a test webhook endpoint and subscribe only to the approved event set.
5. Put the test secret key, webhook signing secret, product IDs, price IDs, and portal configuration IDs into secret storage.
6. Configure `STRIPE_ALLOWED_WEB_ORIGINS` with exact HTTPS origins only.
7. Run sandbox checkout, renewal, payment-failure, grace, cancellation, refund, duplicate-event, pilot, and fleet-seat tests.
8. Verify fleet increases create immediate prorations and grant no seats before provider acceptance.
9. Verify fleet decreases remain pending until renewal and cannot go below assigned required seats.

No live-mode activation is part of this checklist.
