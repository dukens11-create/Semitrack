import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, session, type AdminUser } from "./api";
import type { DashboardData, DriverListItem, DriverProfile, LabelValue, Metric, SeriesPoint, SubscriptionPlanCatalog } from "./types";

type View = "dashboard" | "drivers" | "pricing" | "account" | "audit";
type RangePreset = "today" | "7d" | "30d" | "3m" | "1y" | "custom";
const adminRoles = new Set(["ADMIN", "FLEET_ADMIN", "MODERATOR"]);

export function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!session.access()) { setBooting(false); return; }
    api.get<AdminUser>("/me").then((current) => {
      if (!adminRoles.has(current.role)) throw new ApiError(403, "This account is not authorized for the admin portal");
      setUser(current);
    }).catch(() => session.clear()).finally(() => setBooting(false));
  }, []);

  if (booting) return <div className="center-state"><Spinner /><p>Securing admin session…</p></div>;
  if (!user) return <Login onAuthenticated={setUser} />;
  return <AdminShell user={user} onUserUpdated={setUser} onSignOut={() => { session.clear(); setUser(null); }} />;
}

function Login({ onAuthenticated }: { onAuthenticated: (user: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api.login(email.trim(), password);
      if (!adminRoles.has(result.user.role)) throw new ApiError(403, "This account does not have admin portal access");
      session.save(result.accessToken, result.refreshToken);
      onAuthenticated(result.user);
    } catch (reason) {
      session.clear();
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-brand">
      <Brand />
      <div><span className="eyebrow">SECURE OPERATIONS</span><h1>Real insight.<br />Responsible access.</h1><p>Subscription, driver and navigation analytics backed only by verified SemiTraX records.</p></div>
      <div className="security-note">▣ Role-protected · Sensitive views audited · No driver coordinates</div>
    </section>
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow orange">ADMIN PORTAL</span><h2>Welcome back</h2><p>Use an authorized SemiTraX staff account.</p>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <div className="error-banner">{error}</div>}
      <button className="primary-button" disabled={busy}>{busy ? "Verifying…" : "Sign in securely"}</button>
    </form>
  </main>;
}

function AdminShell({ user, onUserUpdated, onSignOut }: { user: AdminUser; onUserUpdated: (user: AdminUser) => void; onSignOut: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="shell">
    <aside className={menuOpen ? "sidebar open" : "sidebar"}>
      <Brand compact />
      <nav>
        <NavItem active={view === "dashboard"} icon="⌁" label="Analytics" onClick={() => { setView("dashboard"); setMenuOpen(false); }} />
        <NavItem active={view === "drivers"} icon="♙" label="Drivers" onClick={() => { setView("drivers"); setMenuOpen(false); }} />
        {user.role === "ADMIN" && <NavItem active={view === "pricing"} icon="$" label="Plans & pricing" onClick={() => { setView("pricing"); setMenuOpen(false); }} />}
        {user.role === "ADMIN" && <NavItem active={view === "account"} icon="⚿" label="Account security" onClick={() => { setView("account"); setMenuOpen(false); }} />}
        {user.role === "ADMIN" && <NavItem active={view === "audit"} icon="▤" label="Audit logs" onClick={() => { setView("audit"); setMenuOpen(false); }} />}
      </nav>
      <div className="sidebar-safety"><strong>Privacy boundary</strong><span>Live coordinates are not collected by analytics.</span></div>
      <footer><span>{user.fullName}</span><small>{roleLabel(user.role)}</small><button onClick={onSignOut}>Sign out</button></footer>
    </aside>
    <main className="content">
      <header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)}>☰</button><div><span className="eyebrow">SEMITRAX ADMIN</span><h1>{view === "dashboard" ? "Statistics & analytics" : view === "drivers" ? "Driver analytics" : view === "pricing" ? "Plans & pricing" : view === "account" ? "Account security" : "Security audit"}</h1></div><div className="role-pill">{roleLabel(user.role)}</div></header>
      {view === "dashboard" && <Dashboard user={user} />}
      {view === "drivers" && <Drivers user={user} />}
      {view === "pricing" && user.role === "ADMIN" && <PricingSettings />}
      {view === "account" && user.role === "ADMIN" && <AccountSecurity user={user} onUserUpdated={onUserUpdated} onPasswordChanged={onSignOut} />}
      {view === "audit" && <AuditLogs />}
    </main>
  </div>;
}

function Dashboard({ user }: { user: AdminUser }) {
  const [range, setRange] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (range === "custom" && (!customFrom || !customTo)) return;
    setLoading(true); setError("");
    const query = new URLSearchParams({ range });
    if (range === "custom") { query.set("from", new Date(`${customFrom}T00:00:00`).toISOString()); query.set("to", new Date(`${customTo}T23:59:59`).toISOString()); }
    try { setData(await api.get<DashboardData>(`/admin/analytics/dashboard?${query}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load analytics"); }
    finally { setLoading(false); }
  }, [range, customFrom, customTo]);
  useEffect(() => { void load(); }, [load]);

  const mrr = data?.kpis.mrr;
  const projectedMrr = data?.financial && metricFrom(data.financial.projectedMrr);
  return <>
    <section className="filter-row">
      <div className="range-tabs">{(["today", "7d", "30d", "3m", "1y", "custom"] as RangePreset[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{rangeLabel(item)}</button>)}</div>
      {range === "custom" && <div className="custom-range"><input aria-label="From date" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /><span>to</span><input aria-label="To date" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>}
      <button className="refresh" onClick={() => void load()} disabled={loading}>↻ Refresh</button>
    </section>
    {error && <div className="error-banner analytics-error"><strong>Analytics unavailable.</strong> {error}<br /><small>Apply the analytics database migration before starting the updated API.</small></div>}
    {loading && !data ? <div className="center-state panel-height"><Spinner /><p>Calculating from current records…</p></div> : data && <>
      <section className="hero-kpis">
        <MetricCard icon="♟" label="Registered drivers" metric={data.kpis.totalRegisteredDrivers} accent="orange" />
        <MetricCard icon="◆" label="Paid subscribers" metric={data.kpis.activePaidSubscriptions} accent="blue" />
        <MetricCard icon="$" label="Monthly recurring revenue" metric={mrr} accent="green" note={!mrr?.available && projectedMrr ? `Projection: ${formatMetric(projectedMrr)}` : undefined} />
        <MetricCard icon="▰" label="Active trips" metric={data.kpis.activeTrips} accent="violet" />
      </section>
      <section className="mini-kpis">
        <MiniMetric label="Active drivers" metric={data.kpis.activeDrivers} />
        <MiniMetric label="Trials" metric={data.kpis.trialDrivers} />
        <MiniMetric label="New today" metric={data.kpis.newSubscribersToday} />
        <MiniMetric label="New this month" metric={data.kpis.newSubscribersThisMonth} />
        <MiniMetric label="Past due" metric={data.kpis.pastDueSubscriptions} warning />
        <MiniMetric label="Failed payments" metric={data.kpis.failedPayments} danger />
        <MiniMetric label="Canceled" metric={data.kpis.canceledSubscriptions} />
        <MiniMetric label="Revenue today" metric={data.kpis.revenueToday} />
        <MiniMetric label="Revenue this month" metric={data.kpis.revenueThisMonth} />
      </section>

      <section className="chart-grid">
        <ChartPanel title="Revenue over time" subtitle="Verified successful charges only" wide><LineChart data={data.charts.revenueOverTime} valueKey="gross" money empty="No verified payment transactions for this range" /></ChartPanel>
        <ChartPanel title="New subscribers" subtitle="Created subscriptions"><BarChart data={data.charts.newSubscribersOverTime} valueKey="value" empty="No new subscriptions in this range" /></ChartPanel>
        <ChartPanel title="Subscription status" subtitle="Current database state"><DonutChart data={data.charts.subscriptionStatus} /></ChartPanel>
        <ChartPanel title="Monthly subscription growth" subtitle="Started versus canceled"><MultiBarChart data={data.charts.monthlySubscriptionGrowth} /></ChartPanel>
        <ChartPanel title="Driver activity" subtitle="Unique authenticated app opens"><LineChart data={data.charts.driverActivity} valueKey="value" empty="Awaiting app activity telemetry" /></ChartPanel>
        <ChartPanel title="Trips and miles" subtitle="Completed navigation sessions"><TripChart data={data.charts.tripsCompleted} /></ChartPanel>
        <ChartPanel title="Most active states / regions" subtitle="Aggregated; no precise coordinates"><HorizontalBars data={data.charts.mostActiveRegions} empty="Awaiting region-level navigation telemetry" /></ChartPanel>
        <ChartPanel title="Most-used truck stops" subtitle="Commercial stops selected"><HorizontalBars data={data.charts.mostUsedTruckStops} empty="Awaiting truck-stop selection events" /></ChartPanel>
        <ChartPanel title="11-hour HOS warnings" subtitle="Planning warnings displayed"><BarChart data={data.charts.hosWarnings} valueKey="value" empty="No HOS warning events recorded" /></ChartPanel>
      </section>

      <section className="activity-strip">
        <ActivityMetric label="Trips completed" value={data.activity.tripsCompleted} />
        <ActivityMetric label="Miles through SemiTraX" value={data.activity.milesDriven} decimals={1} />
        <ActivityMetric label="Average trip distance" value={data.activity.averageTripDistance} suffix=" mi" decimals={1} />
        <ActivityMetric label="Average navigation time" value={data.activity.averageNavigationSeconds} duration />
        <ActivityMetric label="Fuel-stop searches" value={data.activity.fuelStopSearches} />
        <ActivityMetric label="Parking searches" value={data.activity.parkingSearches} />
      </section>

      <LiveOperations data={data} />
      {user.role === "ADMIN" ? <FinancialSection data={data} /> : <LockedPanel title="Financial analytics" text="Restricted to the ADMIN role. Aggregated operational staff do not receive payment or revenue details." />}
      <CoverageNotice data={data} />
    </>}
  </>;
}

function LiveOperations({ data }: { data: DashboardData }) {
  const live = data.liveOperations;
  return <section className="section-block"><div className="section-heading"><div><span className="eyebrow">LIVE OPERATIONS</span><h2>Current operational pulse</h2></div><span className="live-badge"><i /> Live</span></div>
    <div className="operations-grid">
      <Operation label="Drivers online" value={live.driversOnline} status="ok" />
      <Operation label="Navigating now" value={live.driversNavigating} status="info" />
      <Operation label="Active trips" value={live.activeTrips} status="info" />
      <Operation label="Over drive threshold" value={live.routesOverDrivingThreshold} status="warn" />
      <Operation label="API errors · 24h" value={live.apiErrors24Hours} status={live.apiErrors24Hours ? "danger" : "ok"} />
      <Operation label="Payment problems" value={live.paymentProblems} status={live.paymentProblems ? "danger" : "muted"} />
      <Operation label="HERE service" value={live.hereService.status.replaceAll("_", " ")} status={live.hereService.status === "DEGRADED" ? "warn" : live.hereService.configured ? "ok" : "muted"} />
    </div>
  </section>;
}

function FinancialSection({ data }: { data: DashboardData }) {
  const financial = data.financial;
  if (!financial) return null;
  const keys = [
    ["grossRevenue", "Gross subscription revenue"], ["refunds", "Refunds"], ["processingFees", "Processing fees"],
    ["netRevenue", "Net subscription revenue"], ["mrr", "MRR"], ["arr", "ARR"],
    ["averageRevenuePerPayingUser", "Average revenue / payer"], ["trialConversionRate", "Trial conversion"], ["churnRate", "Customer churn"],
  ];
  return <section className="section-block"><div className="section-heading"><div><span className="eyebrow">ADMIN ONLY</span><h2>Financial analytics</h2></div><span className="audit-chip">Every view audit logged</span></div><div className="finance-grid">{keys.map(([key, label]) => <MiniMetric key={key} label={label} metric={metricFrom(financial[key])} />)}</div></section>;
}

function Drivers({ user }: { user: AdminUser }) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DriverListItem[]>([]);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<{ items: DriverListItem[] }>(`/admin/users?pageSize=100&search=${encodeURIComponent(search)}`);
      setItems(response.items.filter((item) => item.role === "DRIVER"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load drivers"); }
  }, [search]);
  useEffect(() => { void load(); }, [load]);
  async function openDriver(driverId: string) {
    setError("");
    try { setProfile(await api.get<DriverProfile>(`/admin/analytics/drivers/${encodeURIComponent(driverId)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load driver profile"); }
  }
  if (user.role === "MODERATOR") return <LockedPanel title="Driver analytics" text="Driver-level records require an operational ADMIN or FLEET_ADMIN role." />;
  return <section><div className="toolbar"><input className="search-input" placeholder="Search drivers by name or email" value={search} onChange={(e) => setSearch(e.target.value)} /><button className="primary-small" onClick={() => void load()}>Search</button></div>{error && <div className="error-banner">{error}</div>}
    <div className="table-panel"><table><thead><tr><th>Driver</th><th>Plan</th><th>Joined</th><th>Status</th><th /></tr></thead><tbody>{items.map((driver) => <tr key={driver.id}><td><strong>{driver.fullName}</strong><small>{driver.email}</small></td><td>{driver.plan}</td><td>{formatDate(driver.createdAt)}</td><td><Status value={driver.disabledAt ? "DISABLED" : "ACTIVE"} /></td><td><button className="text-button" onClick={() => void openDriver(driver.id)}>View profile →</button></td></tr>)}</tbody></table>{!items.length && <Empty text="No matching driver records" />}</div>
    {profile && <DriverDrawer profile={profile} onClose={() => setProfile(null)} />}
  </section>;
}

function DriverDrawer({ profile, onClose }: { profile: DriverProfile; onClose: () => void }) {
  const user = profile.user;
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><button className="drawer-close" onClick={onClose}>×</button><span className="eyebrow">AUDIT-LOGGED VIEW</span><h2>{user.fullName}</h2><p>{user.email}</p><div className="profile-meta"><span>Plan<strong>{user.plan}</strong></span><span>Joined<strong>{formatDate(String(user.createdAt))}</strong></span><span>Last activity<strong>{user.lastActivityAt ? formatDate(user.lastActivityAt) : "Not recorded"}</strong></span></div><h3>Driving activity</h3><div className="profile-stats">{Object.entries(profile.statistics).map(([key, value]) => <div key={key}><strong>{formatNumber(value)}</strong><span>{humanize(key)}</span></div>)}</div><h3>Truck profiles</h3>{user.trucks.length ? user.trucks.map((truck, index) => <div className="record-card" key={String(truck.id)}><strong>{String(truck.name ?? `Truck ${index + 1}`)}</strong><span>{truck.heightFt ? `${truck.heightFt} ft high` : "Height unavailable"} · {truck.weightLbs ? `${formatNumber(Number(truck.weightLbs))} lb` : "Weight unavailable"}</span></div>) : <Empty text="No truck profile records" />}<h3>Subscription history</h3>{profile.financialAccess ? user.subscriptions.map((subscription) => <div className="record-card" key={String(subscription.id)}><strong>{String(subscription.plan)} · {String(subscription.status)}</strong><span>{String(subscription.provider)} · {formatDate(String(subscription.createdAt))}</span></div>) : <div className="restricted-note">Financial history requires ADMIN access.</div>}<h3>Support history</h3>{profile.supportHistory.length ? profile.supportHistory.map((ticket) => <div className="record-card" key={String(ticket.id)}><strong>{String(ticket.subject || "Subject restricted")}</strong><span>{String(ticket.status)} · {formatDate(String(ticket.createdAt))}</span></div>) : <Empty text="No support ticket records" />}</aside></div>;
}

function PricingSettings() {
  const [plans, setPlans] = useState<SubscriptionPlanCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setPlans((await api.get<{ plans: SubscriptionPlanCatalog[] }>("/admin/subscription-plans")).plans); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load subscription plans"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function replacePlan(updated: SubscriptionPlanCatalog) {
    setPlans((current) => current.map((plan) => plan.code === updated.code ? updated : plan).sort((a, b) => a.sortOrder - b.sortOrder));
  }

  return <section className="pricing-page">
    <div className="pricing-intro">
      <div><span className="eyebrow orange">ADMIN ONLY · AUDIT LOGGED</span><h2>Subscription catalog</h2><p>These are the live prices shown in the SemiTraX app. Changes take effect after a driver refreshes the Premium screen.</p></div>
      <button className="refresh" onClick={() => void load()} disabled={loading}>↻ Reload</button>
    </div>
    <div className="pricing-warning"><strong>Pricing safety</strong><span>Changing a catalog price does not silently alter an existing provider subscription. Existing billing remains governed by its verified payment-provider record.</span></div>
    {error && <div className="error-banner">{error}</div>}
    {loading && !plans.length ? <div className="center-state panel-height"><Spinner /><p>Loading live pricing…</p></div> : <div className="plan-editor-grid">{plans.map((plan) => <PlanEditor key={`${plan.code}-${plan.version}`} plan={plan} onSaved={replacePlan} />)}</div>}
  </section>;
}

function PlanEditor({ plan, onSaved }: { plan: SubscriptionPlanCatalog; onSaved: (plan: SubscriptionPlanCatalog) => void }) {
  const [draft, setDraft] = useState(plan);
  const [price, setPrice] = useState(plan.priceAmountCents === null ? "" : (plan.priceAmountCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isTrial = draft.billingInterval === "TRIAL";

  function change<K extends keyof SubscriptionPlanCatalog>(key: K, value: SubscriptionPlanCatalog[K]) {
    setDraft((current) => ({ ...current, [key]: value })); setMessage("");
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const parsedPrice = isTrial ? 0 : price.trim() === "" ? null : Math.round(Number(price) * 100);
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError("Enter a valid non-negative price."); setBusy(false); return;
    }
    try {
      const response = await api.patch<{ plan: SubscriptionPlanCatalog }>(`/admin/subscription-plans/${encodeURIComponent(plan.code)}`, {
        expectedVersion: draft.version,
        displayName: draft.displayName,
        purpose: draft.purpose,
        description: draft.description?.trim() || null,
        priceAmountCents: parsedPrice,
        currency: draft.currency,
        billingInterval: draft.billingInterval,
        trialDays: isTrial ? draft.trialDays : 0,
        isActive: draft.isActive,
        isPublic: draft.isPublic,
        isFeatured: draft.isFeatured,
        badge: draft.badge?.trim() || null,
        sortOrder: draft.sortOrder,
      });
      setDraft(response.plan); setPrice(response.plan.priceAmountCents === null ? "" : (response.plan.priceAmountCents / 100).toFixed(2));
      onSaved(response.plan); setMessage("Saved and audit logged.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save plan"); }
    finally { setBusy(false); }
  }

  return <form className={`plan-editor ${draft.isFeatured ? "featured" : ""}`} onSubmit={save}>
    <header><div><span className="plan-code">{draft.code}</span><h3>{draft.displayName}</h3></div><Status value={draft.isActive ? "ACTIVE" : "INACTIVE"} /></header>
    <label>Customer-facing name<input value={draft.displayName} onChange={(event) => change("displayName", event.target.value)} maxLength={80} required /></label>
    <label>Purpose<input value={draft.purpose} onChange={(event) => change("purpose", event.target.value)} maxLength={160} required /></label>
    <label>Description<textarea value={draft.description ?? ""} onChange={(event) => change("description", event.target.value || null)} maxLength={500} rows={3} /></label>
    <div className="plan-fields">
      <label>Price ({draft.currency})<input type="number" min="0" max="1000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} disabled={isTrial} placeholder={draft.billingInterval === "CUSTOM" ? "Set later" : "0.00"} required={draft.isActive && ["MONTH", "YEAR"].includes(draft.billingInterval)} /></label>
      <label>Billing<select value={draft.billingInterval} onChange={(event) => change("billingInterval", event.target.value as SubscriptionPlanCatalog["billingInterval"])}><option value="TRIAL">Trial</option><option value="MONTH">Monthly</option><option value="YEAR">Annual</option><option value="CUSTOM">Custom</option></select></label>
      <label>Trial days<input type="number" min="1" max="365" value={draft.trialDays} onChange={(event) => change("trialDays", Number(event.target.value))} disabled={!isTrial} /></label>
      <label>Currency<input value={draft.currency} onChange={(event) => change("currency", event.target.value.toUpperCase())} minLength={3} maxLength={3} required /></label>
      <label>Badge<input value={draft.badge ?? ""} onChange={(event) => change("badge", event.target.value || null)} maxLength={40} placeholder="Optional" /></label>
      <label>Display order<input type="number" min="0" max="10000" value={draft.sortOrder} onChange={(event) => change("sortOrder", Number(event.target.value))} /></label>
    </div>
    <div className="plan-switches">
      <label><input type="checkbox" checked={draft.isActive} onChange={(event) => change("isActive", event.target.checked)} /> Available for selection</label>
      <label><input type="checkbox" checked={draft.isPublic} onChange={(event) => change("isPublic", event.target.checked)} /> Visible in app</label>
      <label><input type="checkbox" checked={draft.isFeatured} onChange={(event) => change("isFeatured", event.target.checked)} /> Featured plan</label>
    </div>
    {error && <div className="inline-message error">{error}</div>}{message && <div className="inline-message success">{message}</div>}
    <footer><small>Version {draft.version} · Updated {formatDate(draft.updatedAt)}</small><button className="primary-small" disabled={busy}>{busy ? "Saving…" : "Save plan"}</button></footer>
  </form>;
}

function AccountSecurity({ user, onUserUpdated, onPasswordChanged }: { user: AdminUser; onUserUpdated: (user: AdminUser) => void; onPasswordChanged: () => void }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (newPassword && newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    if (!newPassword && fullName.trim() === user.fullName && email.trim().toLowerCase() === user.email.toLowerCase()) { setError("Enter a new name, email, or password."); return; }
    setBusy(true);
    try {
      const body: Record<string, string> = { currentPassword };
      if (fullName.trim() !== user.fullName) body.fullName = fullName.trim();
      if (email.trim().toLowerCase() !== user.email.toLowerCase()) body.email = email.trim().toLowerCase();
      if (newPassword) body.newPassword = newPassword;
      const response = await api.patch<{ user: AdminUser; passwordChanged: boolean }>("/admin/account", body);
      onUserUpdated(response.user); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      if (response.passwordChanged) {
        window.alert("Administrator password changed. All refresh sessions were revoked; sign in again with the new password.");
        onPasswordChanged();
      } else {
        setMessage("Administrator account updated and audit logged.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update administrator account"); }
    finally { setBusy(false); }
  }

  return <section className="account-security-page">
    <div className="account-security-intro"><span className="eyebrow orange">ADMIN ONLY · REAUTHENTICATION REQUIRED</span><h2>Administrator login and password</h2><p>Change the email used to sign in or replace your password. Your current password is required for every change.</p></div>
    <form className="account-security-card" onSubmit={save}>
      <div className="account-security-heading"><div className="security-shield">⚿</div><div><h3>Secure administrator account</h3><p>Changes are stored securely and recorded in the audit log.</p></div></div>
      <div className="account-form-grid">
        <label>Administrator name<input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required autoComplete="name" /></label>
        <label>Login email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label>
      </div>
      <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label>
      <div className="account-form-grid">
        <label>New password <small>Leave blank to keep it</small><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={newPassword ? 12 : undefined} maxLength={128} autoComplete="new-password" /></label>
      </div>
      <div className="password-guidance">Use at least 12 characters. A password change revokes every refresh session and requires a new sign-in.</div>
      {error && <div className="inline-message error">{error}</div>}{message && <div className="inline-message success">{message}</div>}
      <footer><span>Current role: {roleLabel(user.role)}</span><button className="primary-small" disabled={busy}>{busy ? "Securing…" : "Save account changes"}</button></footer>
    </form>
  </section>;
}

function AuditLogs() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  useEffect(() => { api.get<{ items: Array<Record<string, unknown>> }>("/admin/audit-logs?pageSize=100").then((data) => setItems(data.items)).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load audit logs")); }, []);
  return <section>{error && <div className="error-banner">{error}</div>}<div className="table-panel"><table><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Time</th></tr></thead><tbody>{items.map((item) => { const actor = item.actor as Record<string, unknown> | undefined; return <tr key={String(item.id)}><td><strong>{humanize(String(item.action))}</strong></td><td>{String(actor?.fullName ?? actor?.email ?? "Unknown")}</td><td>{String(item.targetType)} {item.targetId ? `· ${String(item.targetId)}` : ""}</td><td>{formatDate(String(item.createdAt))}</td></tr>; })}</tbody></table>{!items.length && <Empty text="No audited admin actions" />}</div></section>;
}

function Brand({ compact = false }: { compact?: boolean }) { return <div className={compact ? "brand compact" : "brand"}><img className="brand-logo" src="/semitrax-logo.png" alt="SemiTraX" />{!compact && <small>ADMIN PORTAL</small>}</div>; }
function NavItem({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }) { return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><span>{icon}</span>{label}</button>; }
function Spinner() { return <span className="spinner" />; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>; }
function LockedPanel({ title, text }: { title: string; text: string }) { return <div className="locked-panel"><span>▣</span><div><h2>{title}</h2><p>{text}</p></div></div>; }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span>⌁</span><p>{text}</p></div>; }

function MetricCard({ icon, label, metric, accent, note }: { icon: string; label: string; metric?: Metric; accent: string; note?: string }) { return <article className={`metric-card ${accent}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong title={metric?.reason}>{metric ? formatMetric(metric) : "—"}</strong>{note && <small>{note}</small>}{metric?.definition && <small>{metric.definition}</small>}</div></article>; }
function MiniMetric({ label, metric, warning = false, danger = false }: { label: string; metric?: Metric; warning?: boolean; danger?: boolean }) { return <div className={`mini-metric ${warning ? "warning" : ""} ${danger ? "danger" : ""}`}><span>{label}</span><strong title={metric?.reason}>{metric ? formatMetric(metric) : "—"}</strong>{metric?.reason && !metric.available && <small>{metric.reason}</small>}</div>; }
function ActivityMetric({ label, value, suffix = "", decimals = 0, duration = false }: { label: string; value: number | null; suffix?: string; decimals?: number; duration?: boolean }) { return <div><span>{label}</span><strong>{value === null ? "—" : duration ? formatDuration(value) : `${formatNumber(value, decimals)}${suffix}`}</strong></div>; }
function Operation({ label, value, status }: { label: string; value: number | string | null; status: string }) { return <div className={`operation ${status}`}><span>{label}</span><strong>{value === null ? "—" : typeof value === "number" ? formatNumber(value) : value}</strong></div>; }
function ChartPanel({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) { return <article className={wide ? "chart-panel wide" : "chart-panel"}><header><div><h3>{title}</h3><span>{subtitle}</span></div></header>{children}</article>; }

function LineChart({ data, valueKey, money = false, empty }: { data: SeriesPoint[]; valueKey: keyof SeriesPoint; money?: boolean; empty: string }) {
  const points = data.map((row) => Number(row[valueKey] ?? 0));
  if (!data.length) return <Empty text={empty} />;
  const max = Math.max(...points, 1); const min = Math.min(...points, 0); const span = Math.max(max - min, 1);
  const coords = points.map((value, index) => `${16 + index * (288 / Math.max(points.length - 1, 1))},${112 - ((value - min) / span) * 84}`).join(" ");
  return <div className="chart"><div className="chart-total">{money ? moneyFromCents(points.reduce((a, b) => a + b, 0)) : formatNumber(points.reduce((a, b) => a + b, 0))}</div><svg viewBox="0 0 320 130" role="img" aria-label="Time series"><defs><linearGradient id={`fill-${String(valueKey)}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b2c" stopOpacity=".35" /><stop offset="1" stopColor="#ff6b2c" stopOpacity="0" /></linearGradient></defs><path d={`M ${coords.replaceAll(" ", " L ")} L 304 122 L 16 122 Z`} fill={`url(#fill-${String(valueKey)})`} /><polyline points={coords} fill="none" stroke="#ff6b2c" strokeWidth="3" strokeLinejoin="round" />{coords.split(" ").map((point, index) => { const [x, y] = point.split(","); return <circle key={index} cx={x} cy={y} r="3" fill="#ff6b2c" />; })}</svg><AxisLabels data={data} /></div>;
}
function BarChart({ data, valueKey, empty }: { data: SeriesPoint[]; valueKey: keyof SeriesPoint; empty: string }) {
  if (!data.length) return <Empty text={empty} />;
  const values = data.map((row) => Number(row[valueKey] ?? 0)); const max = Math.max(...values, 1);
  return <div className="bar-chart">{data.map((row, index) => <div className="bar-column" key={row.bucket}><strong>{formatNumber(values[index])}</strong><div><i style={{ height: `${Math.max(3, values[index] / max * 100)}%` }} /></div><span>{shortDate(row.bucket)}</span></div>)}</div>;
}
function MultiBarChart({ data }: { data: SeriesPoint[] }) { if (!data.length) return <Empty text="No subscription changes in this range" />; const max = Math.max(...data.flatMap((row) => [row.started ?? 0, row.canceled ?? 0]), 1); return <div className="bar-chart grouped">{data.map((row) => <div className="bar-column" key={row.bucket}><div><i className="started" style={{ height: `${Math.max(3, (row.started ?? 0) / max * 100)}%` }} /><i className="canceled" style={{ height: `${Math.max(3, (row.canceled ?? 0) / max * 100)}%` }} /></div><span>{shortDate(row.bucket)}</span></div>)}</div>; }
function TripChart({ data }: { data: SeriesPoint[] }) { if (!data.length) return <Empty text="Awaiting completed navigation sessions" />; return <div><LineChart data={data.map((row) => ({ ...row, value: row.trips }))} valueKey="value" empty="" /><div className="chart-legend"><span><i className="orange-dot" /> Completed trips</span><strong>{formatNumber(data.reduce((sum, row) => sum + (row.miles ?? 0), 0), 1)} mi</strong></div></div>; }
function HorizontalBars({ data, empty }: { data: LabelValue[]; empty: string }) { if (!data.length) return <Empty text={empty} />; const max = Math.max(...data.map((row) => row.value), 1); return <div className="horizontal-bars">{data.slice(0, 6).map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${row.value / max * 100}%` }} /></i><strong>{formatNumber(row.value)}</strong></div>)}</div>; }
function DonutChart({ data }: { data: LabelValue[] }) { if (!data.length) return <Empty text="No subscription records" />; const colors = ["#3bc86a", "#2f89ff", "#ffb52e", "#ff5f56", "#8f6dff", "#6a88a1"]; const total = data.reduce((sum, item) => sum + item.value, 0); let cursor = 0; const stops = data.map((item, index) => { const start = cursor; cursor += total ? item.value / total * 360 : 0; return `${colors[index % colors.length]} ${start}deg ${cursor}deg`; }); return <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }}><span><strong>{formatNumber(total)}</strong>Total</span></div><div className="donut-legend">{data.map((item, index) => <div key={item.label}><i style={{ background: colors[index % colors.length] }} /><span>{humanize(item.label)}</span><strong>{item.value}</strong></div>)}</div></div>; }
function AxisLabels({ data }: { data: SeriesPoint[] }) { const labels = data.length <= 4 ? data : [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]]; return <div className="axis-labels">{labels.map((row) => <span key={row.bucket}>{shortDate(row.bucket)}</span>)}</div>; }

function CoverageNotice({ data }: { data: DashboardData }) { const missing = [!data.coverage.payments && "payments", !data.coverage.appEvents && "app events", !data.coverage.navigationSessions && "navigation sessions"].filter(Boolean); return <div className={missing.length ? "coverage-notice" : "coverage-notice complete"}><strong>{missing.length ? "Data coverage is still building" : "All analytics sources reporting"}</strong><span>{missing.length ? `Waiting for real ${missing.join(", ")} data. Unavailable cards remain blank.` : "Dashboard values are backed by current database records."}</span></div>; }

function metricFrom(value: unknown): Metric | undefined { return value && typeof value === "object" && "available" in value ? value as Metric : undefined; }
function formatMetric(metric: Metric) { if (!metric.available || metric.value === null) return "—"; if (metric.currency && metric.scale === "cents") return moneyFromCents(metric.value); if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(1)}%`; return formatNumber(metric.value); }
function moneyFromCents(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value / 100); }
function formatNumber(value: number, decimals = 0) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value); }
function formatDuration(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return hours ? `${hours}h ${minutes}m` : `${minutes}m`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date); }
function shortDate(value: string) { const date = new Date(value); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date); }
function rangeLabel(range: RangePreset) { return ({ today: "Today", "7d": "7 Days", "30d": "30 Days", "3m": "3 Months", "1y": "1 Year", custom: "Custom" })[range]; }
function roleLabel(role: AdminUser["role"]) { return ({ ADMIN: "Super administrator", FLEET_ADMIN: "Operations administrator", MODERATOR: "Moderator", DRIVER: "Driver" })[role]; }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }
