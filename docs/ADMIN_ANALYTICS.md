# SemiTraX Admin Analytics

The admin dashboard reports database-backed values only. A metric with no
verified source is returned as unavailable and rendered as an em dash; the UI
does not replace missing values with demo numbers.

## Access

| Area | Roles | Audit logged |
| --- | --- | --- |
| Aggregate dashboard | `ADMIN`, `FLEET_ADMIN`, `MODERATOR` | Financial access is logged |
| Financial analytics | `ADMIN` | Yes |
| Driver account analytics | `ADMIN`, `FLEET_ADMIN` | Yes |
| Driver financial details | `ADMIN` | Yes |

The analytics API does not accept or store latitude/longitude. Precise live
driver locations are not part of this dashboard. Any future location console
must use a separate operational-purpose permission and write a dedicated audit
record for every access.

## Data sources and coverage

- Driver counts and activity: `User.lastActivityAt`.
- Trips, miles and navigation time: completed `Trip` and
  `NavigationSession` records.
- Searches and warning counts: allow-listed `AppAnalyticsEvent` records.
- Subscription status: `Subscription` and `SubscriptionStatusEvent`.
- Revenue, refunds, fees and payment failures: verified
  `PaymentTransaction` records.
- API failures: sanitized `ApiErrorLog` records. Request bodies, tokens and
  credentials are never recorded.

MRR is reported as actual only when active subscriptions have provider-backed
price and billing-interval data. Until payment ingestion is connected, the
dashboard labels the `$9.99 x active subscriptions` value as a projection and
keeps actual revenue metrics unavailable.

## Install and run

```powershell
cd C:\Users\duken\Documents\semitrack\apps\api
.\node_modules\.bin\prisma.cmd generate
.\node_modules\.bin\prisma.cmd migrate deploy
npm run dev
```

In another terminal:

```powershell
cd C:\Users\duken\Documents\semitrack\apps\admin
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and sign in with an authorized staff account.
The portal deliberately has no demo-data mode.
