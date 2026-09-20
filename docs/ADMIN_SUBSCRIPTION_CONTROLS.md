# Admin pricing and subscription access

## Administrator workflow

Sign in to SemiTraX Admin with the ADMIN role, then open **Plans & pricing**.

### Publish display prices

1. Edit the introductory monthly, regular monthly, annual, or per-driver fleet amounts in dollars.
2. Enter a reason. Select **Review and save prices**.
3. Review the before/after amounts in the confirmation and confirm.

The API stores integer cents, increments the catalog version and writes an audit record atomically. Simultaneous/stale edits receive a conflict and require refresh. Prices must be positive with at most two decimal places. The introductory price cannot exceed renewal; larger fleet tiers cannot cost more per driver than smaller tiers.

The app reads this versioned catalog on opening/refreshing Plans & Subscription. If it cannot load valid current pricing, it clearly labels bundled defaults as reference prices. Existing verified invoice/renewal amounts are never derived from the catalog.

These are **published display prices**. This control does not update Google Play, Apple or Stripe products, create charges, change contractual prices, or enable billing. Before purchases can go live, published offers must be reconciled with approved provider products and verified checkout quotes. The 14-day trial, three introductory paid periods and product identifiers remain unchanged. Fleet 250+ remains Contact Sales.

### Review payment delays

The **Payment delays & access** section defaults to overdue/retry/grace-period records. Search by subscriber name/email, switch to all subscriptions or manually suspended records, and page through results.

- Verified grace periods are honored until their exact end timestamp.
- At expiry, that source cannot grant premium entitlement on recomputation. Cached positive entitlement deadlines cannot exceed the verified grace deadline.
- A PAST_DUE record with a verified future grace deadline retains access until that deadline. Without a grace deadline it does not grant access.
- No indefinite GRACE_PERIOD/BILLING_RETRY entitlement is permitted without a valid end.
- Automatic payment recovery can restore normal provider-backed entitlement. An explicit manual suspension remains until an administrator reviews and restores it.

### Suspend or restore

**Suspend access** requires verified overdue evidence after grace has ended. Enter a reason and confirm. **Restore access** requires a verified ACTIVE or CANCEL_AT_PERIOD_END record with a paid period that has not expired. Neither control can mark an invoice paid, change provider status, charge/refund/cancel a subscription, or create a paid entitlement.

Actions use version checks and locks; repeated stale submissions fail safely. The action, reason and provider status are recorded in Admin audit history in the same transaction as the access hold. An audit-write failure rolls back the change. Other independent valid access sources remain valid; a hold applies to its specific subscription.

## Runtime and rollout boundaries

The new controls work with the existing verified subscription and entitlement foundation. They **do not yet constitute a live application-wide payment blockade**: existing route endpoints do not currently mount `requireEntitlement`, and billing/provider adapters remain unactivated. Premium enforcement and provider lifecycle/device acceptance must be completed and reviewed before claiming live payment blocking. This local change intentionally does not remove existing route/navigation capabilities or interrupt active guidance. It does not bypass CoPilot provisioning.

Before a separately approved deployment, migration **20260919030000_subscription_admin_controls** must be applied with the backend rollout. It adds `SubscriptionPricingConfig` and `SubscriptionAccessHold`; it does not rewrite existing subscriptions or invoices. The previous twelve migrations remain unchanged. Rollback to old code would not honor new holds, so access-control rollback requires an explicit operational decision.

ADMIN authorization is enforced on every controls endpoint. Public catalog reads do not expose subscriber information. Authenticated account views expose only the current user's verified records and sanitized hold/grace facts. No receipt, provider credential, or raw billing event is returned by the new controls.

No deployment, production migration, live charge, provider request or billing activation was performed.
