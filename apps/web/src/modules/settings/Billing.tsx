import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, type LimitKey, type Limits, type PlanId } from "@mfc/core";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import * as I from "../../ui/icons";

interface PlanRow {
  id: PlanId;
  name: string;
  limits: Limits;
  features: string[];
  price: { amount: number | null; currency: string; interval: string | null } | null;
  available: boolean;
}
interface BillingInfo {
  enabled: boolean;
  plan: PlanId | "unlimited";
  status: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  hasCustomer: boolean;
  usage: Record<LimitKey, number>;
  limits: Limits;
  plans: PlanRow[];
}

const METERS: LimitKey[] = ["projects", "members", "storageMb", "monitors", "deployTargets", "plugins"];

export function money(p: PlanRow["price"], locale: string): string | null {
  if (!p || p.amount === null) return null;
  if (p.amount === 0) return null;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100);
  } catch {
    return `${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
  }
}

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit?: string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const tone = limit && pct >= 100 ? "var(--mfc-danger)" : limit && pct >= 80 ? "var(--mfc-warning)" : "var(--mfc-accent)";
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row small" style={{ gap: 6 }}>
        <span className="grow">{label}</span>
        <span className="mono muted">
          {used.toLocaleString()}
          {unit ?? ""} / {limit === null ? "∞" : `${limit.toLocaleString()}${unit ?? ""}`}
        </span>
      </div>
      <div className="meter" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? undefined}>
        <span style={{ width: limit === null ? "0%" : `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

export default function Billing() {
  const t = useT();
  const locale = document.documentElement.lang || "en";
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const manage = can(role, "billing.manage");
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const load = () => api.get<BillingInfo>(ws("/billing")).then(setInfo).catch((e: Error) => toast(e.message, "error"));

  useEffect(() => {
    void load();
    const result = params.get("checkout");
    if (result) {
      toast(result === "success" ? t("billing.thanks") : t("billing.cancelled"), result === "success" ? "success" : "info");
      params.delete("checkout");
      setParams(params, { replace: true });
      // The webhook can land a moment after the redirect.
      if (result === "success") setTimeout(() => void load(), 2500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (path: string, body?: unknown) => {
    setBusy(path);
    try {
      const r = await api.post<{ url: string }>(ws(path), body ?? {});
      window.location.assign(r.url);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(null);
    }
  };

  if (!info) return <div className="muted">{t("common.loading")}</div>;
  const unit = (k: LimitKey) => (k === "storageMb" ? " MB" : "");

  if (!info.enabled) {
    return (
      <div className="col" style={{ gap: 16, maxWidth: 720 }}>
        <div className="card col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <I.IconCheck size={18} style={{ color: "var(--mfc-success)" }} />
            <strong>{t("billing.selfHosted")}</strong>
          </div>
          <p className="muted small">{t("billing.selfHostedBody")}</p>
          <pre className="code-view small" style={{ whiteSpace: "pre-wrap" }}>{`STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…   # endpoint: ${location.origin}/api/billing/webhook
STRIPE_PRICE_PRO=price_…
STRIPE_PRICE_TEAM=price_…`}</pre>
        </div>
        <div className="card col" style={{ gap: 12 }}>
          <strong>{t("billing.usage")}</strong>
          {METERS.map((k) => <Meter key={k} label={t(`billing.limit.${k}`)} used={info.usage[k]} limit={null} unit={unit(k)} />)}
        </div>
      </div>
    );
  }

  const current = info.plans.find((p) => p.id === info.plan);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card row wrap" style={{ gap: 12 }}>
        <div className="col grow" style={{ gap: 4 }}>
          <span className="small muted">{t("billing.current")}</span>
          <strong style={{ fontSize: 20 }}>
            {current?.name ?? info.plan}
            {info.status && info.status !== "active" && <span className={`badge ${info.status === "past_due" ? "badge-danger" : ""}`} style={{ marginLeft: 8 }}>{t(`billing.status.${info.status}`)}</span>}
          </strong>
          {info.renewsAt && (
            <span className="small muted">{t(info.cancelAtPeriodEnd ? "billing.endsOn" : "billing.renewsOn", { date: new Date(info.renewsAt).toLocaleDateString(locale) })}</span>
          )}
        </div>
        {manage && info.hasCustomer && (
          <button className="btn" disabled={!!busy} onClick={() => void go("/billing/portal")}>
            <I.IconCard size={14} /> {t("billing.manage")}
          </button>
        )}
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <strong>{t("billing.usage")}</strong>
        {METERS.map((k) => <Meter key={k} label={t(`billing.limit.${k}`)} used={info.usage[k]} limit={info.limits[k]} unit={unit(k)} />)}
      </div>

      <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 12 }}>
        {info.plans.map((p) => {
          const isCurrent = p.id === info.plan;
          const price = money(p.price, locale);
          return (
            <div key={p.id} className="card col plan-card" style={{ gap: 10, outline: isCurrent ? "2px solid var(--mfc-accent)" : undefined }}>
              <div className="row">
                <strong className="grow" style={{ fontSize: 17 }}>{p.name}</strong>
                {isCurrent && <span className="badge badge-accent">{t("billing.yourPlan")}</span>}
              </div>
              <div>
                <span style={{ fontSize: 26, fontWeight: 700 }}>{p.id === "free" ? t("billing.free") : price ?? "—"}</span>
                {price && p.price?.interval && <span className="muted small"> / {t(`billing.per.${p.price.interval}`)}</span>}
              </div>
              <ul className="small col plan-list">
                {METERS.map((k) => (
                  <li key={k}>
                    <I.IconCheck size={13} /> {p.limits[k] === null ? t("billing.unlimited") : `${p.limits[k]!.toLocaleString()}${unit(k)}`} {t(`billing.limit.${k}`).toLowerCase()}
                  </li>
                ))}
              </ul>
              {p.id !== "free" && !isCurrent && manage && (
                <button className="btn btn-primary" disabled={!p.available || !!busy} onClick={() => void go("/billing/checkout", { plan: p.id })} title={p.available ? undefined : t("billing.noPrice")}>
                  {busy === "/billing/checkout" ? <I.IconSpinner size={14} className="spin" /> : null} {info.hasSubscription ? t("billing.switch") : t("billing.upgrade")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!manage && <p className="hint">{t("billing.ownerOnly")}</p>}
      <p className="hint">{t("billing.note")}</p>
    </div>
  );
}
