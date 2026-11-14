import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { HealthBadge, UptimeBars, type Health } from "../../ui/charts";
import { useT } from "../../lib/i18n";

interface Status {
  title: string;
  description: string;
  overall: "operational" | "degraded" | "outage";
  monitors: Array<{ name: string; state: "up" | "down" | "degraded" | "unknown"; uptime: number | null; daily: Array<{ day: string; uptime: number }> }>;
  incidents: Array<{ title: string; cause: string | null; started_at: string; resolved_at: string | null }>;
}
const OVERALL: Record<Status["overall"], Health> = { operational: "good", degraded: "warn", outage: "bad" };
const STATE: Record<string, Health> = { up: "good", degraded: "warn", down: "bad", unknown: "none" };

/** Public, unauthenticated status page: /status/:slug */
export default function StatusPage() {
  const t = useT();
  const { slug } = useParams();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const load = () => fetch(`/api/status/${encodeURIComponent(slug ?? "")}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setS).catch(() => setError(true));
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [slug]);
  const labels = { good: t("mon.h.good"), warn: t("mon.h.warn"), bad: t("mon.h.bad"), none: t("mon.h.none") };
  if (error) return <div className="auth-wrap"><div className="empty">{t("notFound.body")}</div></div>;
  if (!s) return <div className="auth-wrap muted">{t("common.loading")}</div>;
  return (
    <div style={{ minHeight: "100dvh", padding: "40px 16px" }}>
      <div className="col" style={{ maxWidth: 760, margin: "0 auto", gap: 18 }}>
        <div>
          <h1 className="page-title">{s.title}</h1>
          {s.description && <p className="page-subtitle">{s.description}</p>}
        </div>
        <div className="card row" style={{ gap: 10, padding: 18 }}>
          <HealthBadge health={OVERALL[s.overall]} label={t(`mon.overall.${s.overall}`)} />
          <span className="grow" />
          <span className="small muted">{t("mon.autoRefresh")}</span>
        </div>
        {s.monitors.map((m) => (
          <div key={m.name} className="card col" style={{ gap: 8 }}>
            <div className="row"><strong className="grow">{m.name}</strong><span className="small muted">{m.uptime === null ? "—" : `${(m.uptime * 100).toFixed(2)}%`} · 90 d</span><HealthBadge health={STATE[m.state]} label={t(`mon.state.${m.state}`)} /></div>
            <UptimeBars days={m.daily} count={90} labels={labels} />
          </div>
        ))}
        <strong>{t("mon.incidents")}</strong>
        {s.incidents.length === 0 ? <div className="hint">{t("mon.noIncidents")}</div> : s.incidents.map((i, k) => (
          <div key={k} className="card col" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8 }}><HealthBadge health={i.resolved_at ? "good" : "bad"} label={i.resolved_at ? t("mon.resolved") : t("mon.ongoing")} /><strong>{i.title}</strong></div>
            <span className="small muted">{new Date(i.started_at).toLocaleString()}{i.resolved_at ? ` → ${new Date(i.resolved_at).toLocaleString()}` : ""}{i.cause ? ` · ${i.cause}` : ""}</span>
          </div>
        ))}
        <p className="small muted" style={{ textAlign: "center" }}>Powered by Multi-functional Creator</p>
      </div>
    </div>
  );
}
