import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  accessControlLabel,
  parsePriceForm,
  priceFields,
  type Prices,
  type PriceKey,
  type SubscriptionRow,
} from "./subscriptionControls";

type PriceRecord = { prices: Prices; version: number; updatedAt: string };
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to complete this action.";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not reported";
export function PriceForm({
  record,
  onSaved,
}: {
  record: PriceRecord;
  onSaved: (value: PriceRecord) => void;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      priceFields.map(([key]) => [key, (record.prices[key] / 100).toFixed(2)])
    ) as Record<PriceKey, string>
  );
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    setError("");
    try {
      const prices = parsePriceForm(values);
      if (reason.trim().length < 5)
        throw new Error("Add a short reason for the audit log.");
      const summary = priceFields
        .map(
          ([key, label]) =>
            `${label}: $${(record.prices[key] / 100).toFixed(2)} → $${(
              prices[key] / 100
            ).toFixed(2)}`
        )
        .join("\n");
      if (
        !window.confirm(
          `Publish these display prices?\n\n${summary}\n\nExisting subscriptions and store billing prices will not change.`
        )
      )
        return;
      lock.current = true;
      setBusy(true);
      onSaved(
        await api.patch<PriceRecord>("/admin/subscription-controls/pricing", {
          expectedVersion: record.version,
          prices,
          reason: reason.trim(),
          confirmation: "UPDATE DISPLAY PRICES",
        })
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="plan-editor" onSubmit={save}>
      <h3>App display prices · USD</h3>
      <p>
        14-day trial and 3 introductory paid periods stay unchanged. Fleet 250+
        remains Contact Sales.
      </p>
      <div className="plan-fields">
        {priceFields.map(([key, label, hint]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              inputMode="decimal"
              value={values[key]}
              disabled={busy}
              onChange={(e) =>
                setValues((v) => ({ ...v, [key]: e.target.value }))
              }
              required
            />
            <small>{hint}</small>
          </label>
        ))}
      </div>
      <label>
        Reason for change
        <input
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={500}
          required
          placeholder="For example: approved pricing review"
        />
      </label>
      {error && (
        <p role="alert" className="inline-message error">
          {error}
        </p>
      )}
      <footer>
        <small>
          Version {record.version} · Updated {date(record.updatedAt)}
        </small>
        <button className="primary-small" disabled={busy}>
          {busy ? "Saving…" : "Review and save prices"}
        </button>
      </footer>
    </form>
  );
}

export function SubscriptionAccessCard({
  row,
  onChanged,
}: {
  row: SubscriptionRow;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    suspend = !row.hold.suspended;
  const permitted = suspend ? row.canSuspend : row.canRestore;
  async function change(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !permitted) return;
    setError("");
    setMessage("");
    if (
      !window.confirm(
        `${
          suspend ? "Suspend" : "Restore"
        } this subscription's premium access for ${
          row.user.fullName
        }?\nThis does not charge, cancel, refund or mark a payment as paid.`
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      await api.patch(
        "/admin/subscription-controls/subscriptions/" +
          encodeURIComponent(row.id) +
          "/access",
        {
          expectedVersion: row.hold.version,
          suspended: suspend,
          reason: reason.trim(),
          confirmation: suspend ? "SUSPEND" : "RESTORE",
        }
      );
      setMessage("Access decision saved and audit logged.");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="plan-editor" onSubmit={change}>
      <header>
        <div>
          <h3>{row.user.fullName}</h3>
          <small>{row.user.email}</small>
        </div>
        <strong>{row.status.replaceAll("_", " ")}</strong>
      </header>
      <p>
        {row.plan} · {row.provider} ·{" "}
        {row.environment === "PRODUCTION"
          ? "Production record"
          : "Test / sandbox record"}
      </p>
      <strong>{accessControlLabel(row)}</strong>
      <dl>
        <dt>Verified by provider</dt>
        <dd>{date(row.verifiedAt)}</dd>
        <dt>Grace period ends</dt>
        <dd>{date(row.gracePeriodEnd)}</dd>
        <dt>Current period ends</dt>
        <dd>{date(row.currentPeriodEnd)}</dd>
      </dl>
      <label>
        Reason for access change
        <input
          aria-label={"Reason for " + row.user.email}
          disabled={busy || !permitted}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={500}
          required
        />
      </label>
      {!permitted && (
        <p>
          {suspend
            ? "Suspension requires verified overdue payment after any grace period ends."
            : "Restore requires verified active payment and an unexpired paid period."}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-message error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        className="primary-small"
        disabled={busy || !permitted || reason.trim().length < 5}
      >
        {busy ? "Saving…" : suspend ? "Suspend access" : "Restore access"}
      </button>
      <small>
        A suspension holds this subscription's access until an administrator
        restores it. Other valid access sources remain independent.
      </small>
    </form>
  );
}

export function SubscriptionAdmin() {
  const [pricing, setPricing] = useState<PriceRecord | null>(null),
    [priceError, setPriceError] = useState(""),
    [notice, setNotice] = useState("");
  const [items, setItems] = useState<SubscriptionRow[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [filter, setFilter] = useState("overdue"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const loadPricing = useCallback(async () => {
    setPriceError("");
    try {
      setPricing(
        await api.get<PriceRecord>("/admin/subscription-controls/pricing")
      );
    } catch (e) {
      setPriceError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void loadPricing();
  }, [loadPricing]);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    setItems([]);
    void api
      .get<{ items: SubscriptionRow[]; total: number }>(
        "/admin/subscription-controls/subscriptions?" +
          new URLSearchParams({ page: String(page), filter, search: query })
      )
      .then((result) => {
        if (current) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [page, filter, query, refresh]);
  return (
    <section className="pricing-page">
      <div className="pricing-intro">
        <div>
          <span className="eyebrow orange">ADMIN ONLY · AUDIT LOGGED</span>
          <h2>Pricing & subscription access</h2>
          <p>
            Clear prices, verified payment status, and controlled access
            changes.
          </p>
        </div>
        <button
          className="refresh"
          onClick={() => {
            void loadPricing();
            setRefresh((v) => v + 1);
          }}
        >
          Refresh
        </button>
      </div>
      <div className="pricing-warning">
        <strong>Billing stays separate</strong>
        <span>
          Price changes update the app's displayed offers after refresh. They do
          not reprice existing subscribers, configure store products, or
          activate billing. Google Play, Apple and Stripe prices need separate
          approved provider setup.
        </span>
      </div>
      {priceError && (
        <p role="alert" className="error-banner">
          {priceError}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pricing && (
        <PriceForm
          key={pricing.version}
          record={pricing}
          onSaved={(value) => {
            setPricing(value);
            setNotice(
              "Display prices published. Existing subscription charges are unchanged."
            );
          }}
        />
      )}
      <h2>Payment delays & access</h2>
      <p>
        Honor the verified provider grace period. After expiry, this
        subscription no longer grants premium entitlement. Restored provider
        payments can recover normal access; manual suspensions require a
        reviewed restore.
      </p>
      <p>
        Checks apply at online entitlement refresh. Cached access follows its
        existing expiry. Active truck guidance is not forcibly interrupted. No
        action here marks an invoice paid.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <label>
          Show
          <select
            aria-label="Subscription filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="overdue">Payment delays</option>
            <option value="suspended">Suspended by admin</option>
            <option value="all">All subscriptions</option>
          </select>
        </label>
        <input
          aria-label="Find subscriber"
          placeholder="Name or email"
          value={search}
          maxLength={120}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="primary-small">Search</button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">Loading subscriptions…</p>
      ) : (
        <div className="plan-editor-grid">
          {items.map((row) => (
            <SubscriptionAccessCard
              key={row.id + ":" + row.hold.version}
              row={row}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          ))}
        </div>
      )}
      {!busy && !error && !items.length && (
        <p>No subscriptions match this view.</p>
      )}
      <div className="toolbar">
        <button
          className="refresh"
          disabled={busy || page === 1}
          onClick={() => setPage((v) => v - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} · {total} subscriptions
        </span>
        <button
          className="refresh"
          disabled={busy || page * 25 >= total}
          onClick={() => setPage((v) => v + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
