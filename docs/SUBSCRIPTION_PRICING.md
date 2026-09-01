# Semi-Trax subscription pricing

The `SubscriptionPlanCatalog` table contains planning prices for administration and automated checks. Google Play and Apple localized store prices will be authoritative for mobile purchases; verified Stripe price IDs will be authoritative for website and fleet billing.

| Code | Plan | Planning price | Trial | Activation |
| --- | --- | ---: | ---: | --- |
| `MONTHLY` | Individual monthly | $19.99/month | 7 days when eligible | Provider setup pending |
| `ANNUAL` | Individual annual | $199.99/year | 7 days when eligible | Provider setup pending |
| `PILOT_MONTHLY` | Founding 100 pilot | $9.99/month for 6 months | None | Admin invitation and provider setup pending |
| `FLEET_1_4` | Fleet 1–4 drivers | $19.99/driver/month | None | Stripe setup pending |
| `FLEET_5_24` | Fleet 5–24 drivers | $17.99/driver/month | None | Stripe setup pending |
| `FLEET_25_99` | Fleet 25–99 drivers | $15.99/driver/month | None | Stripe setup pending |
| `FLEET_100_PLUS` | Fleet 100+ | Contact Semi-Trax | None | Sales-assisted contract |

Pilot pricing and the regular seven-day trial are mutually exclusive. A `WELCOME_OFFER` uniqueness constraint and backend policy prevent stacking them.

Fleet sales email: `contact@semitrax.com`.

Planned contact page: `https://www.semitrax.com/#contact`. Until that anchor is verified, use `mailto:contact@semitrax.com?subject=Semi-Trax%20Fleet%20Subscription` as a user-facing fallback. A `mailto:` address is never used as an API redirect.

Changing a catalog planning price does not alter an existing provider subscription. Provider prices are created and selected separately, and subscription access changes only after verified provider processing.

Billing remains disabled. See `docs/STRIPE_PHASE3_TEST_SETUP.md` before creating products or enabling Stripe test mode.
