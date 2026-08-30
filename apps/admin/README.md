# SemiTraX Admin Analytics

The admin portal reads protected analytics from `apps/api`. It never ships demo
statistics and renders unavailable metrics as an em dash with a data-coverage
explanation.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The API must have the `20260823000000_admin_analytics` migration applied.
Financial views require the `ADMIN` role. Driver-level views require `ADMIN` or
`FLEET_ADMIN` and are audit logged. Analytics telemetry stores only an optional
state/region label; it does not accept precise driver coordinates.

## Create the first administrator

SemiTraX does not ship a shared or hard-coded administrator password. After
the database migrations have been applied, create the first administrator from
an interactive PowerShell terminal:

```powershell
cd C:\Users\duken\Documents\semitrack\apps\api
npm run admin:create
```

The command asks for the administrator name and email and masks the password.
It works only while there is no active `ADMIN`, preventing it from becoming an
uncontrolled administrator-reset mechanism. Credentials are never printed.

After signing in, an `ADMIN` can use **Account security** to change their own
login email or password. The current password is required, password changes
revoke refresh sessions, and every change is written to `AdminAuditLog`.
