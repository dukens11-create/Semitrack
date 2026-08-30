import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import type { AnalyticsRange } from "./analyticsRange.js";
export { parseAnalyticsRange } from "./analyticsRange.js";

const asNumber = (value: unknown) => typeof value === "bigint" ? Number(value) : Number(value ?? 0);
const isoRows = (rows: Array<Record<string, unknown>>, valueKeys: string[]) => rows.map((row) => ({
  ...row,
  bucket: row.bucket instanceof Date ? row.bucket.toISOString() : row.bucket,
  ...Object.fromEntries(valueKeys.map((key) => [key, asNumber(row[key])])),
}));

async function queryRows<T extends Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...values);
}

async function paymentCoverage() {
  const rows = await queryRows<{ total: bigint }>(`SELECT COUNT(*)::bigint AS total FROM "PaymentTransaction"`);
  return asNumber(rows[0]?.total) > 0;
}

export async function getAdminDashboard(range: AnalyticsRange, includeFinancial: boolean) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const presenceCutoff = new Date(now.getTime() - env.analyticsPresenceMinutes * 60_000);
  const navigationCutoff = new Date(now.getTime() - env.analyticsNavigationStaleMinutes * 60_000);
  const bucket = range.bucket;

  const [
    totalDrivers,
    activeDrivers,
    activePaidSubscriptions,
    trialDrivers,
    newSubscribersToday,
    newSubscribersMonth,
    canceledSubscriptions,
    pastDueSubscriptions,
    subscriptionStatus,
    newSubscribersSeries,
    monthlyGrowth,
    liveRows,
    eventCoverageRows,
    navigationCoverageRows,
    driverActivity,
    tripsSeries,
    tripTotals,
    regions,
    truckStops,
    searches,
    hosWarnings,
    apiErrors,
    providerStates,
    hasPayments,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "DRIVER" } }),
    queryRows<{ value: bigint }>(
      `SELECT COUNT(*)::bigint AS value FROM "User" WHERE role = 'DRIVER' AND "disabledAt" IS NULL AND "lastActivityAt" >= $1`,
      presenceCutoff),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "TRIALING" } }),
    prisma.subscription.count({ where: { createdAt: { gte: today }, status: { in: ["ACTIVE", "TRIALING"] } } }),
    prisma.subscription.count({ where: { createdAt: { gte: monthStart }, status: { in: ["ACTIVE", "TRIALING"] } } }),
    prisma.subscription.count({ where: { status: "CANCELED" } }),
    prisma.subscription.count({ where: { status: "PAST_DUE" } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    queryRows<{ bucket: Date; value: bigint }>(
      `SELECT date_trunc('${bucket}', "createdAt") AS bucket, COUNT(*)::bigint AS value
       FROM "Subscription" WHERE "createdAt" >= $1 AND "createdAt" < $2
       GROUP BY 1 ORDER BY 1`, range.from, range.to),
    queryRows<{ bucket: Date; started: bigint; canceled: bigint }>(
      `SELECT month AS bucket,
              (SELECT COUNT(*) FROM "Subscription" s
                WHERE s."createdAt" >= month AND s."createdAt" < month + interval '1 month')::bigint AS started,
              (SELECT COUNT(*) FROM "Subscription" s
                WHERE s."canceledAt" >= month AND s."canceledAt" < month + interval '1 month')::bigint AS canceled
       FROM generate_series(date_trunc('month', $1::timestamp), date_trunc('month', $2::timestamp), interval '1 month') month
       ORDER BY month`, range.from, range.to),
    queryRows<{ online: bigint; navigating: bigint; exceeding: bigint }>(
      `SELECT
        (SELECT COUNT(*) FROM "User" WHERE role = 'DRIVER' AND "disabledAt" IS NULL AND "lastActivityAt" >= $1)::bigint AS online,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND "lastHeartbeatAt" >= $2)::bigint AS navigating,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND "lastHeartbeatAt" >= $2 AND "estimatedDriveMinutes" > $3)::bigint AS exceeding
       FROM "NavigationSession"`, presenceCutoff, navigationCutoff, env.analyticsDrivingThresholdMinutes),
    queryRows<{ total: bigint }>(`SELECT COUNT(*)::bigint AS total FROM "AppAnalyticsEvent"`),
    queryRows<{ total: bigint }>(`SELECT COUNT(*)::bigint AS total FROM "NavigationSession"`),
    queryRows<{ bucket: Date; value: bigint }>(
      `SELECT date_trunc('${bucket}', "occurredAt") AS bucket, COUNT(DISTINCT "userId")::bigint AS value
       FROM "AppAnalyticsEvent" WHERE "eventType" = 'APP_OPENED' AND "occurredAt" >= $1 AND "occurredAt" < $2
       GROUP BY 1 ORDER BY 1`, range.from, range.to),
    queryRows<{ bucket: Date; trips: bigint; miles: number }>(
      `SELECT date_trunc('${bucket}', "endedAt") AS bucket, COUNT(*)::bigint AS trips,
              COALESCE(SUM("actualDistanceMiles"), 0)::double precision AS miles
       FROM "NavigationSession" WHERE status = 'COMPLETED' AND "endedAt" >= $1 AND "endedAt" < $2
       GROUP BY 1 ORDER BY 1`, range.from, range.to),
    queryRows<{ trips: bigint; miles: number; avg_distance: number | null; avg_duration: number | null }>(
      `SELECT COUNT(*)::bigint AS trips,
              COALESCE(SUM("actualDistanceMiles"), 0)::double precision AS miles,
              AVG("actualDistanceMiles")::double precision AS avg_distance,
              AVG("actualDurationSeconds")::double precision AS avg_duration
       FROM "NavigationSession" WHERE status = 'COMPLETED' AND "endedAt" >= $1 AND "endedAt" < $2`, range.from, range.to),
    queryRows<{ label: string; value: bigint }>(
      `SELECT "stateRegion" AS label, COUNT(DISTINCT "userId")::bigint AS value
       FROM "NavigationSession" WHERE "stateRegion" IS NOT NULL AND "startedAt" >= $1 AND "startedAt" < $2
       GROUP BY "stateRegion" ORDER BY value DESC LIMIT 10`, range.from, range.to),
    queryRows<{ label: string; value: bigint }>(
      `SELECT COALESCE("entityId", 'Unknown') AS label, COUNT(*)::bigint AS value
       FROM "AppAnalyticsEvent" WHERE "eventType" = 'TRUCK_STOP_SELECTED' AND "occurredAt" >= $1 AND "occurredAt" < $2
       GROUP BY "entityId" ORDER BY value DESC LIMIT 10`, range.from, range.to),
    queryRows<{ eventType: string; value: bigint }>(
      `SELECT "eventType", COUNT(*)::bigint AS value FROM "AppAnalyticsEvent"
       WHERE "eventType" IN ('FUEL_STOP_SEARCH', 'PARKING_SEARCH') AND "occurredAt" >= $1 AND "occurredAt" < $2
       GROUP BY "eventType"`, range.from, range.to),
    queryRows<{ bucket: Date; value: bigint }>(
      `SELECT date_trunc('${bucket}', "occurredAt") AS bucket, COUNT(*)::bigint AS value
       FROM "AppAnalyticsEvent" WHERE "eventType" = 'HOS_WARNING_SHOWN' AND "occurredAt" >= $1 AND "occurredAt" < $2
       GROUP BY 1 ORDER BY 1`, range.from, range.to),
    queryRows<{ value: bigint }>(`SELECT COUNT(*)::bigint AS value FROM "ApiErrorLog" WHERE "occurredAt" >= $1`, new Date(now.getTime() - 86_400_000)),
    prisma.providerSyncState.findMany({
      orderBy: { updatedAt: "desc" },
      select: { provider: true, jurisdiction: true, dataType: true, status: true, lastSuccessAt: true, lastErrorCode: true },
    }),
    paymentCoverage(),
  ]);

  const live = liveRows[0] ?? { online: 0n, navigating: 0n, exceeding: 0n };
  const trip = tripTotals[0] ?? { trips: 0n, miles: 0, avg_distance: null, avg_duration: null };
  const eventCoverage = asNumber(eventCoverageRows[0]?.total) > 0;
  const navigationCoverage = asNumber(navigationCoverageRows[0]?.total) > 0;
  const searchMap = new Map(searches.map((row) => [row.eventType, asNumber(row.value)]));

  const financial = includeFinancial
    ? await getFinancialAnalytics(range, activePaidSubscriptions, hasPayments)
    : null;

  return {
    generatedAt: now.toISOString(),
    range: { preset: range.preset, from: range.from.toISOString(), to: range.to.toISOString(), bucket },
    kpis: {
      totalRegisteredDrivers: { value: totalDrivers, available: true },
      activeDrivers: { value: asNumber(activeDrivers[0]?.value), available: true, definition: `Authenticated within ${env.analyticsPresenceMinutes} minutes` },
      activePaidSubscriptions: { value: activePaidSubscriptions, available: true },
      trialDrivers: { value: trialDrivers, available: true },
      newSubscribersToday: { value: newSubscribersToday, available: true },
      newSubscribersThisMonth: { value: newSubscribersMonth, available: true },
      canceledSubscriptions: { value: canceledSubscriptions, available: true },
      pastDueSubscriptions: { value: pastDueSubscriptions, available: true },
      failedPayments: financial?.failedPayments ?? { value: null, available: false, reason: "Financial analytics require verified payment transactions and ADMIN access" },
      mrr: financial?.mrr ?? { value: null, available: false, reason: "Financial analytics require ADMIN access" },
      arr: financial?.arr ?? { value: null, available: false, reason: "Financial analytics require ADMIN access" },
      revenueToday: financial?.revenueToday ?? { value: null, available: false, reason: "Financial analytics require ADMIN access" },
      revenueThisMonth: financial?.revenueThisMonth ?? { value: null, available: false, reason: "Financial analytics require ADMIN access" },
      activeTrips: { value: navigationCoverage ? asNumber(live.navigating) : null, available: navigationCoverage, reason: navigationCoverage ? undefined : "No navigation-session telemetry has been received" },
    },
    charts: {
      revenueOverTime: financial?.revenueOverTime ?? [],
      newSubscribersOverTime: isoRows(newSubscribersSeries, ["value"]),
      subscriptionStatus: subscriptionStatus.map((item) => ({ label: item.status, value: item._count._all })),
      monthlySubscriptionGrowth: isoRows(monthlyGrowth, ["started", "canceled"]),
      driverActivity: eventCoverage ? isoRows(driverActivity, ["value"]) : [],
      tripsCompleted: navigationCoverage ? isoRows(tripsSeries, ["trips", "miles"]) : [],
      hosWarnings: eventCoverage ? isoRows(hosWarnings, ["value"]) : [],
      mostActiveRegions: navigationCoverage ? regions.map((row) => ({ label: row.label, value: asNumber(row.value) })) : [],
      mostUsedTruckStops: eventCoverage ? truckStops.map((row) => ({ label: row.label, value: asNumber(row.value) })) : [],
    },
    activity: {
      tripsCompleted: navigationCoverage ? asNumber(trip.trips) : null,
      milesDriven: navigationCoverage ? asNumber(trip.miles) : null,
      averageTripDistance: navigationCoverage && trip.avg_distance !== null ? asNumber(trip.avg_distance) : null,
      averageNavigationSeconds: navigationCoverage && trip.avg_duration !== null ? asNumber(trip.avg_duration) : null,
      fuelStopSearches: eventCoverage ? (searchMap.get("FUEL_STOP_SEARCH") ?? 0) : null,
      parkingSearches: eventCoverage ? (searchMap.get("PARKING_SEARCH") ?? 0) : null,
      hosWarningRoutes: eventCoverage ? hosWarnings.reduce((sum, row) => sum + asNumber(row.value), 0) : null,
    },
    liveOperations: {
      driversOnline: asNumber(live.online),
      driversNavigating: navigationCoverage ? asNumber(live.navigating) : null,
      activeTrips: navigationCoverage ? asNumber(live.navigating) : null,
      routesOverDrivingThreshold: navigationCoverage ? asNumber(live.exceeding) : null,
      apiErrors24Hours: asNumber(apiErrors[0]?.value),
      paymentProblems: financial?.livePaymentProblems ?? null,
      hereService: {
        configured: Boolean(env.hereApiKey),
        status: providerStates.some((item) => item.provider.toUpperCase().includes("HERE") && ["DEGRADED", "ERROR"].includes(item.status)) ? "DEGRADED" : env.hereApiKey ? "CONFIGURED" : "NOT_CONFIGURED",
      },
      providerStates,
    },
    coverage: {
      payments: hasPayments,
      appEvents: eventCoverage,
      navigationSessions: navigationCoverage,
      note: "Unavailable metrics are returned as null and must never be replaced with sample values.",
    },
    financial,
  };
}

export async function getFinancialAnalytics(range: AnalyticsRange, activeSubscriptions?: number, knownCoverage?: boolean) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const hasPayments = knownCoverage ?? await paymentCoverage();
  const activeCount = activeSubscriptions ?? await prisma.subscription.count({ where: { status: "ACTIVE" } });

  const [periodRows, todayRows, monthRows, revenueSeries, pricingRows, trialRows, monthlyCatalogRows] = await Promise.all([
    queryRows<{ gross: bigint; refunds: bigint; failed: bigint; fees: bigint }>(
      `SELECT
        COALESCE(SUM("amountCents") FILTER (WHERE type = 'CHARGE' AND status = 'SUCCEEDED'), 0)::bigint AS gross,
        COALESCE(SUM("amountCents") FILTER (WHERE type = 'REFUND' AND status = 'SUCCEEDED'), 0)::bigint AS refunds,
        COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
        COALESCE(SUM("processingFeeCents") FILTER (WHERE status = 'SUCCEEDED'), 0)::bigint AS fees
       FROM "PaymentTransaction" WHERE "occurredAt" >= $1 AND "occurredAt" < $2`, range.from, range.to),
    queryRows<{ gross: bigint }>(`SELECT COALESCE(SUM("amountCents") FILTER (WHERE type = 'CHARGE' AND status = 'SUCCEEDED'), 0)::bigint AS gross FROM "PaymentTransaction" WHERE "occurredAt" >= $1`, today),
    queryRows<{ gross: bigint }>(`SELECT COALESCE(SUM("amountCents") FILTER (WHERE type = 'CHARGE' AND status = 'SUCCEEDED'), 0)::bigint AS gross FROM "PaymentTransaction" WHERE "occurredAt" >= $1`, monthStart),
    queryRows<{ bucket: Date; gross: bigint; refunds: bigint }>(
      `SELECT date_trunc('${range.bucket}', "occurredAt") AS bucket,
              COALESCE(SUM("amountCents") FILTER (WHERE type = 'CHARGE' AND status = 'SUCCEEDED'), 0)::bigint AS gross,
              COALESCE(SUM("amountCents") FILTER (WHERE type = 'REFUND' AND status = 'SUCCEEDED'), 0)::bigint AS refunds
       FROM "PaymentTransaction" WHERE "occurredAt" >= $1 AND "occurredAt" < $2 GROUP BY 1 ORDER BY 1`, range.from, range.to),
    queryRows<{ priced: bigint; mrr: number }>(
      `SELECT COUNT(*) FILTER (WHERE "priceAmountCents" IS NOT NULL AND "billingInterval" IN ('month', 'year'))::bigint AS priced,
              COALESCE(SUM(CASE WHEN "billingInterval" = 'month' THEN "priceAmountCents" WHEN "billingInterval" = 'year' THEN "priceAmountCents" / 12.0 ELSE 0 END), 0)::double precision AS mrr
       FROM "Subscription" WHERE status = 'ACTIVE'`),
    queryRows<{ trials: bigint; converted: bigint }>(
      `SELECT COUNT(DISTINCT "subscriptionId") FILTER (WHERE status = 'TRIALING')::bigint AS trials,
              COUNT(DISTINCT "subscriptionId") FILTER (WHERE status = 'ACTIVE' AND "subscriptionId" IN
                (SELECT "subscriptionId" FROM "SubscriptionStatusEvent" WHERE status = 'TRIALING'))::bigint AS converted
       FROM "SubscriptionStatusEvent" WHERE "occurredAt" >= $1 AND "occurredAt" < $2`, range.from, range.to),
    queryRows<{ priceAmountCents: number | null; currency: string }>(
      `SELECT "priceAmountCents", currency FROM "SubscriptionPlanCatalog"
       WHERE code = 'MONTHLY' AND "isActive" = true LIMIT 1`),
  ]);

  const period = periodRows[0] ?? { gross: 0n, refunds: 0n, failed: 0n, fees: 0n };
  const pricing = pricingRows[0] ?? { priced: 0n, mrr: 0 };
  const pricedCount = asNumber(pricing.priced);
  const completePricing = activeCount === 0 || pricedCount === activeCount;
  const actualMrr = completePricing ? asNumber(pricing.mrr) : null;
  const gross = asNumber(period.gross);
  const refunds = asNumber(period.refunds);
  const fees = asNumber(period.fees);
  const trial = trialRows[0] ?? { trials: 0n, converted: 0n };
  const trials = asNumber(trial.trials);
  const converted = asNumber(trial.converted);
  const monthlyCatalog = monthlyCatalogRows[0];
  const projectedMrr = monthlyCatalog?.priceAmountCents === null || monthlyCatalog?.priceAmountCents === undefined
    ? null
    : activeCount * monthlyCatalog.priceAmountCents;

  const moneyMetric = (value: number | null, available: boolean, reason?: string) => ({ value, available, currency: "USD", scale: "cents", reason });
  return {
    grossRevenue: moneyMetric(hasPayments ? gross : null, hasPayments, hasPayments ? undefined : "No verified payment transactions have been ingested"),
    refunds: moneyMetric(hasPayments ? refunds : null, hasPayments, hasPayments ? undefined : "No verified payment transactions have been ingested"),
    failedPayments: { value: hasPayments ? asNumber(period.failed) : null, available: hasPayments, reason: hasPayments ? undefined : "No verified payment transactions have been ingested" },
    processingFees: moneyMetric(hasPayments ? fees : null, hasPayments, hasPayments ? undefined : "Provider fee data is unavailable"),
    netRevenue: moneyMetric(hasPayments ? gross - refunds - fees : null, hasPayments),
    mrr: moneyMetric(actualMrr, completePricing, completePricing ? undefined : `${activeCount - pricedCount} active subscriptions do not have provider-confirmed pricing`),
    arr: moneyMetric(actualMrr === null ? null : actualMrr * 12, completePricing),
    projectedMrr: {
      ...moneyMetric(projectedMrr, projectedMrr !== null, projectedMrr === null ? "No active monthly catalog price is configured" : undefined),
      projection: true,
      assumption: projectedMrr === null ? undefined : "Current monthly catalog price multiplied by active subscriptions",
    },
    averageRevenuePerPayingUser: moneyMetric(hasPayments && activeCount > 0 ? gross / activeCount : null, hasPayments && activeCount > 0),
    churnRate: { value: null, available: false, reason: "Requires complete subscription status history across two billing periods" },
    trialConversionRate: { value: trials > 0 ? converted / trials : null, available: trials > 0, unit: "ratio", reason: trials > 0 ? undefined : "No trial status history exists for this period" },
    revenueToday: moneyMetric(hasPayments ? asNumber(todayRows[0]?.gross) : null, hasPayments),
    revenueThisMonth: moneyMetric(hasPayments ? asNumber(monthRows[0]?.gross) : null, hasPayments),
    livePaymentProblems: hasPayments ? asNumber(period.failed) : null,
    revenueOverTime: hasPayments ? isoRows(revenueSeries, ["gross", "refunds"]) : [],
  };
}

export async function getAdminDriverProfile(driverId: string, includeFinancial: boolean) {
  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: {
      id: true, fullName: true, email: true, phone: true, role: true, plan: true,
      emailVerified: true, disabledAt: true, createdAt: true, updatedAt: true,
      trucks: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] },
    },
  });
  if (!user) return null;

  const [tripRows, sessions, support, payments, accountRows, subscriptions] = await Promise.all([
    prisma.trip.aggregate({ where: { userId: driverId }, _count: { _all: true }, _sum: { distanceMiles: true } }),
    queryRows<{ trips: bigint; miles: number; seconds: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS trips,
              COALESCE(SUM("actualDistanceMiles") FILTER (WHERE status = 'COMPLETED'), 0)::double precision AS miles,
              COALESCE(SUM("actualDurationSeconds") FILTER (WHERE status = 'COMPLETED'), 0)::double precision AS seconds
       FROM "NavigationSession" WHERE "userId" = $1`, driverId),
    queryRows<{ id: string; subject: string; status: string; priority: string; createdAt: Date; updatedAt: Date }>(
      includeFinancial
        ? `SELECT id, subject, status, priority, "createdAt", "updatedAt" FROM "SupportTicket" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`
        : `SELECT id, '' AS subject, status, priority, "createdAt", "updatedAt" FROM "SupportTicket" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`, driverId),
    includeFinancial ? queryRows<Record<string, unknown>>(
      `SELECT id, provider, type, status, "amountCents", "processingFeeCents", currency, "failureCode", "occurredAt"
       FROM "PaymentTransaction" WHERE "userId" = $1 ORDER BY "occurredAt" DESC LIMIT 100`, driverId) : Promise.resolve([]),
    queryRows<{ lastActivityAt: Date | null }>(`SELECT "lastActivityAt" FROM "User" WHERE id = $1`, driverId),
    includeFinancial ? queryRows<Record<string, unknown>>(
      `SELECT id, provider, "productId", plan, status, "currentPeriodEnd", "canceledAt", "verifiedAt",
              "priceAmountCents", "priceCurrency", "billingInterval", "createdAt", "updatedAt"
       FROM "Subscription" WHERE "userId" = $1 ORDER BY "updatedAt" DESC`, driverId) : Promise.resolve([]),
  ]);
  const session = sessions[0] ?? { trips: 0n, miles: 0, seconds: 0 };
  return {
    user: { ...user, lastActivityAt: accountRows[0]?.lastActivityAt ?? null, subscriptions },
    statistics: {
      plannedTrips: tripRows._count._all,
      plannedMiles: tripRows._sum.distanceMiles ?? 0,
      completedNavigationSessions: asNumber(session.trips),
      actualMiles: asNumber(session.miles),
      actualNavigationSeconds: asNumber(session.seconds),
    },
    supportHistory: support,
    paymentHistory: payments,
    financialAccess: includeFinancial,
  };
}
