import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT, useI18n } from "../../lib/i18n";
import * as I from "../../ui/icons";

interface AuditEvent {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  created_at: string;
  user_email: string | null;
}

const PREFIXES = ["", "auth", "secret", "project", "member", "workspace", "ai"];
const tone = (a: string) => (a.startsWith("secret.reveal") || a.startsWith("secret.export") ? "badge-warning" : a.endsWith("delete") || a.endsWith("remove") ? "badge-danger" : a.startsWith("auth") ? "badge-accent" : "");

function describe(e: AuditEvent): string {
  const m = e.meta ?? {};
  const name = (m.name as string) ?? (m.email as string) ?? "";
  const env = m.environment ? ` · ${m.environment}` : "";
  if (e.action === "ai.turn") return `${m.model ?? ""} · ${m.effort ?? ""} · ${m.input ?? 0} in / ${m.output ?? 0} out`;
  if (e.action === "secret.import") return `${(m.created as string[] | undefined)?.length ?? 0} created, ${(m.rotated as string[] | undefined)?.length ?? 0} rotated${env}`;
  if (e.action === "secret.export") return `${(m.names as string[] | undefined)?.join(", ") ?? ""}${env}`;
  return `${name}${env}${m.version ? ` · v${m.version}` : ""}`;
}

export default function AuditPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const workspaceId = useSession((s) => s.workspaceId);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: string) => {
    try {
      const q = new URLSearchParams({ limit: "50" });
      if (before) q.set("before", before);
      if (filter) q.set("action", filter);
      const r = await api.get<{ events: AuditEvent[] }>(ws(`/audit?${q}`));
      setEvents((prev) => (before ? [...prev, ...r.events] : r.events));
      setMore(r.events.length === 50);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [filter, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t("audit.title")}</h1>
            <p className="page-subtitle">{t("audit.subtitle")}</p>
          </div>
          <div className="row">
          <a className="btn" href={ws("/audit/export.csv")} download><I.IconDownload size={14} /> CSV</a>
          <select className="select" style={{ width: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
            {PREFIXES.map((p) => <option key={p} value={p}>{p || "All events"}</option>)}
          </select>
          </div>
        </div>
        {error ? <div className="empty">{error}</div> : events.length === 0 ? <div className="empty">{t("common.none")}</div> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="small muted" style={{ whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString(locale)}</td>
                    <td className="small">{e.user_email ?? "—"}</td>
                    <td><span className={`badge ${tone(e.action)}`}>{e.action}</span></td>
                    <td className="small">{describe(e)}</td>
                    <td className="small muted mono">{e.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more && events.length > 0 && (
          <button className="btn" style={{ marginTop: 12 }} onClick={() => load(events[events.length - 1].id)}>
            <I.IconChevronDown size={14} /> {t("audit.loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
