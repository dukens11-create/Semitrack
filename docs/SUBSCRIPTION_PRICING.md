# SemiTraX subscription pricing

SemiTraX subscription prices are stored in PostgreSQL in the
`SubscriptionPlanCatalog` table. They are not hard-coded in Flutter and they
are not derived from example dashboard numbers.

The initial catalog is:

| Code | Customer plan | Initial price | Purpose |
| --- | --- | --- | --- |
| `TRIAL` | 7-Day Trial | Free for 7 days | Let drivers evaluate Premium |
| `MONTHLY` | SemiTraX Monthly | $9.99/month | Main individual plan |
| `ANNUAL` | SemiTraX Annual | $99.99/year | Annual value plan |
| `FLEET` | SemiTraX Fleet | Coming later | Custom price per driver or truck |

## Admin controls

Only an authenticated user with the `ADMIN` role can open **Plans & pricing**
or call the plan-management API. An administrator can change the visible
name, purpose, description, price, currency, billing interval, trial days,
badge, display order, availability, public visibility, and featured state.

Every successful change:

- requires the version currently shown in the editor, preventing one admin
  from unknowingly overwriting another admin's newer change;
- is written to `AdminAuditLog` with the before and after records;
- becomes visible in the mobile Premium screen after it is refreshed.

Changing a catalog price does **not** modify existing payment-provider
subscriptions. Existing billing remains governed by each subscription's
verified provider price. A future Stripe price/product integration should
create or select a provider price and then update the catalog in a controlled,
audited operation.

## Apply the database migration

Stop the running API first so Windows releases the Prisma query-engine DLL.
Then run:

```powershell
cd C:\Users\duken\Documents\semitrack\apps\api
.\node_modules\.bin\prisma.cmd generate
.\node_modules\.bin\prisma.cmd migrate deploy
npm run dev
```

The mobile app uses the public `GET /subscription-plans` endpoint. The admin
portal uses the protected `GET /admin/subscription-plans` and
`PATCH /admin/subscription-plans/:code` endpoints.

## Run the admin portal

```powershell
cd C:\Users\duken\Documents\semitrack\apps\admin
npm run dev
```

Sign in with an account whose backend role is `ADMIN`, then select
**Plans & pricing** in the left navigation.

## Build Android

```powershell
cd C:\Users\duken\Documents\semitrack
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\tools\here_flutter.ps1 build-android `
  -FlutterCommand "C:\Users\duken\Documents\Codex\tools\flutter\bin\flutter.bat" `
  -AndroidTargetPlatform android-arm64
```

The Premium screen intentionally refuses to claim that a payment or
subscription change occurred while secure checkout is not configured.
