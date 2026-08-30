import type { AdminUser } from "./api";

export type Metric = {
  value: number | null;
  available: boolean;
  currency?: string;
  scale?: "cents";
  unit?: string;
  reason?: string;
  definition?: string;
  projection?: boolean;
  assumption?: string;
};

export type SeriesPoint = { bucket: string; value?: number; gross?: number; refunds?: number; trips?: number; miles?: number; started?: number; canceled?: number };
export type LabelValue = { label: string; value: number };

export type DashboardData = {
  generatedAt: string;
  range: { preset: string; from: string; to: string; bucket: string };
  kpis: Record<string, Metric>;
  charts: {
    revenueOverTime: SeriesPoint[];
    newSubscribersOverTime: SeriesPoint[];
    subscriptionStatus: LabelValue[];
    monthlySubscriptionGrowth: SeriesPoint[];
    driverActivity: SeriesPoint[];
    tripsCompleted: SeriesPoint[];
    hosWarnings: SeriesPoint[];
    mostActiveRegions: LabelValue[];
    mostUsedTruckStops: LabelValue[];
  };
  activity: Record<string, number | null>;
  liveOperations: {
    driversOnline: number;
    driversNavigating: number | null;
    activeTrips: number | null;
    routesOverDrivingThreshold: number | null;
    apiErrors24Hours: number;
    paymentProblems: number | null;
    hereService: { configured: boolean; status: string };
    providerStates: Array<{ provider: string; jurisdiction: string; dataType: string; status: string; lastSuccessAt: string | null; lastErrorCode: string | null }>;
  };
  coverage: { payments: boolean; appEvents: boolean; navigationSessions: boolean; note: string };
  financial: null | Record<string, Metric | SeriesPoint[] | number | null>;
};

export type DriverListItem = AdminUser & {
  emailVerified: boolean;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriverProfile = {
  user: AdminUser & Record<string, unknown> & { subscriptions: Array<Record<string, unknown>>; trucks: Array<Record<string, unknown>>; lastActivityAt: string | null };
  statistics: Record<string, number>;
  supportHistory: Array<Record<string, unknown>>;
  paymentHistory: Array<Record<string, unknown>>;
  financialAccess: boolean;
};

export type SubscriptionPlanCatalog = {
  code: string;
  displayName: string;
  purpose: string;
  description: string | null;
  priceAmountCents: number | null;
  currency: string;
  billingInterval: "TRIAL" | "MONTH" | "YEAR" | "CUSTOM";
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  isFeatured: boolean;
  badge: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
