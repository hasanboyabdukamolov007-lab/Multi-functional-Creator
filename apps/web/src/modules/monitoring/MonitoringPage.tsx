import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can } from "@mfc/core";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { ask, confirmDialog } from "../../ui/dialog";
import { vaultApi, type SecretMeta } from "../vault/vaultApi";
import { BarList, HealthBadge, LineChart, Sparkline, UptimeBars, VITAL_THRESHOLDS, formatVital, vitalHealth, type Health } from "../../ui/charts";
import * as I from "../../ui/icons";

interface Monitor {
  id: string;
  name: string;
  url: string;
  method: string;
  interval_s: number;
  expect_status: number | null;
  keyword: string | null;
  public: boolean;
  enabled: boolean;
  state: "up" | "down" | "degraded" | "unknown";
  last_checked_at: string | null;
  recent: Array<{ at: string; ok: boolean; ms: number | null; status: number | null }> | null;
  summary: { uptime: number | null; checks: number; daily: Array<{ day: string; uptime: number; avgMs: number | null }> };
}
interface Stats {
  totals: { views: number; visitors: number; errors: number; events: number };
  series: Array<{ t: string; views: number; visitors: number }>;
  pages: Array<{ key: string; count: number }>;
  referrers: Array<{ key: string; count: number }>;
  devices: Array<{ key: string; count: number }>;
  browsers: Array<{ key: string; count: number }>;
  countries: Array<{ key: string; count: number }>;
  events: Array<{ key: string; count: number }>;
  vitals: Array<{ name: string; p75: number; samples: number }>;
  errors: Array<{ message: string; count: number; last: string; stack: string | null; path: string | null }>;
}
interface Channel {
  id: string;
  name: string;
  kind: "email" | "telegram" | "slack" | "discord" | "webhook";
  config: Record<string, string>;
  secret_id: string | null;
  secret_name: string | null;
  events: string[];
  enabled: boolean;
}
const STATE_HEALTH: Record<Monitor["state"], Health> = { up: "good", degraded: "warn", down: "bad", unknown: "none" };
const m = (p: string) => ws(`/monitoring${p}`);

function Uptime({ t, manage }: { t: (k: string, v?: Record<string, string | number>) => string; manage: boolean }) {
  const [list, setList] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Array<{ id: string; title: string; cause: string | null; started_at: string; resolved_at: string | null }>>([]);
  const [form, setForm] = useState<null | { name: string; url: string; intervalS: number; keyword: string; public: boolean }>(null);
  const [page, setPage] = useState<{ slug: string; title: string; description: string; enabled: boolean } | null>(null);
  const reload = () => {
    api.get<{ monitors: Monitor[] }>(m("/monitors")).then((r) => setList(r.monitors)).catch(() => setList([]));
    api.get<{ incidents: typeof incidents }>(m("/incidents")).then((r) => setIncidents(r.incidents)).catch(() => setIncidents([]));
    api.get<{ page: typeof page }>(m("/status-page")).then((r) => setPage(r.page)).catch(() => setPage(null));
  };
  useEffect(reload, []);
  const labels = { good: t("mon.h.good"), warn: t("mon.h.warn"), bad: t("mon.h.bad"), none: t("mon.h.none") };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    try {
      await api.post(m("/monitors"), { name: form.name, url: form.url, intervalS: form.intervalS, keyword: form.keyword || null, public: form.public });
      setForm(null);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const [slug, setSlug] = useState("");
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <strong className="grow">{t("mon.monitors")} ({list.length})</strong>
        {manage && !form && <button className="btn btn-primary btn-sm" onClick={() => setForm({ name: "", url: "https://", intervalS: 300, keyword: "", public: true })}><I.IconPlus size={14} /> {t("mon.addMonitor")}</button>}
      </div>
      {form && (
        <form className="card grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: 10 }} onSubmit={save}>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("common.name")}</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Website" /></label>
          <label className="col" style={{ gap: 4 }}><span className="label">URL</span><input className="input mono" required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("mon.every")}</span>
            <select className="select" value={form.intervalS} onChange={(e) => setForm({ ...form, intervalS: Number(e.target.value) })}>{[60, 300, 900, 1800, 3600].map((s) => <option key={s} value={s}>{s < 3600 ? `${s / 60} min` : "1 h"}</option>)}</select></label>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("mon.keyword")}</span><input className="input" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="optional" /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} /> {t("mon.public")}</label>
          <div className="row"><button className="btn btn-primary">{t("common.save")}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t("common.cancel")}</button></div>
        </form>
      )}
      {list.length === 0 && !form && <div className="empty">{t("mon.noMonitors")}</div>}
      {list.map((x) => (
        <div key={x.id} className="card col" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <HealthBadge health={STATE_HEALTH[x.state]} label={t(`mon.state.${x.state}`)} />
            <div className="grow col" style={{ minWidth: 0 }}><strong className="ellipsis">{x.name}</strong><span className="small muted ellipsis mono">{x.url}</span></div>
            <div className="col small" style={{ alignItems: "flex-end" }}>
              <strong>{x.summary.uptime === null ? "—" : `${(x.summary.uptime * 100).toFixed(2)}%`}</strong>
              <span className="muted">{t("mon.uptime30")}</span>
            </div>
            <Sparkline values={(x.recent ?? []).map((c) => (c.ok ? c.ms : null))} label={t("mon.responseTimes")} />
            {manage && <button className="btn btn-sm" onClick={() => void api.post<{ ok: boolean; ms: number; error: string | null }>(m(`/monitors/${x.id}/check`)).then((r) => (toast(r.ok ? `✓ ${r.ms} ms` : `✕ ${r.error}`, r.ok ? "success" : "error"), reload()))}>{t("mon.checkNow")}</button>}
            {manage && <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && api.del(m(`/monitors/${x.id}`)).then(reload))}><I.IconTrash size={14} /></button>}
          </div>
          <UptimeBars days={x.summary.daily} count={30} labels={labels} />
          <div className="small muted">{x.last_checked_at ? t("mon.lastChecked", { when: new Date(x.last_checked_at).toLocaleString() }) : t("mon.notChecked")} · {t("mon.everyN", { n: Math.round(x.interval_s / 60) })}{x.public ? ` · ${t("mon.onStatusPage")}` : ""}</div>
        </div>
      ))}
      {list.length > 0 && (
        <div className="row wrap small muted" style={{ gap: 12 }}>
          {(["good", "warn", "bad", "none"] as const).map((h) => <span key={h} className="row" style={{ gap: 4 }}><span className={`uptime-bar h-${h}`} style={{ width: 10, height: 10, display: "inline-block" }} /> {labels[h]}</span>)}
        </div>
      )}

      <strong>{t("mon.incidents")}</strong>
      {incidents.length === 0 ? <div className="hint">{t("mon.noIncidents")}</div> : incidents.map((i) => (
        <div key={i.id} className="row wrap small" style={{ gap: 8 }}>
          <HealthBadge health={i.resolved_at ? "good" : "bad"} label={i.resolved_at ? t("mon.resolved") : t("mon.ongoing")} />
          <strong>{i.title}</strong>
          <span className="muted">{i.cause}</span>
          <span className="muted">{new Date(i.started_at).toLocaleString()}{i.resolved_at ? ` → ${new Date(i.resolved_at).toLocaleTimeString()}` : ""}</span>
        </div>
      ))}

      <div className="card col" style={{ gap: 8 }}>
        <strong>{t("mon.statusPage")}</strong>
        {page ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn btn-sm btn-primary" href={`/status/${page.slug}`} target="_blank" rel="noopener noreferrer"><I.IconExternal size={13} /> /status/{page.slug}</a>
            <span className="small muted">{page.title}</span>
          </div>
        ) : <p className="hint">{t("mon.statusHint")}</p>}
        {manage && (
          <form className="row wrap" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); void api.put<{ url: string }>(m("/status-page"), { slug: slug || page?.slug, title: page?.title ?? "Service status", enabled: true }).then((r) => (toast(r.url, "success"), reload())).catch((err: Error) => toast(err.message, "error")); }}>
            <input className="input input-sm mono" style={{ width: 200 }} placeholder={page?.slug ?? "my-company"} value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="slug" />
            <button className="btn btn-sm">{page ? t("common.save") : t("mon.publish")}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Analytics({ t, manage }: { t: (k: string, v?: Record<string, string | number>) => string; manage: boolean }) {
  const [sites, setSites] = useState<Array<{ id: string; name: string; key: string; domains: string[] }>>([]);
  const [collectUrl, setCollectUrl] = useState("");
  const [site, setSite] = useState("");
  const [range, setRange] = useState("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const reload = () => api.get<{ sites: typeof sites; collectUrl: string }>(m("/sites")).then((r) => (setSites(r.sites), setCollectUrl(r.collectUrl), setSite((s) => s || r.sites[0]?.id || ""))).catch(() => setSites([]));
  useEffect(() => void reload(), []);
  useEffect(() => {
    if (!site) return;
    setStats(null);
    api.get<Stats>(m(`/sites/${site}/stats?range=${range}`)).then(setStats).catch(() => setStats(null));
  }, [site, range]);
  const cur = sites.find((s) => s.id === site);
  const snippet = cur ? `<script defer src="${collectUrl}" data-site="${cur.key}"></script>` : "";
  const add = async () => {
    const name = (await ask(t("mon.siteName"))) ?? "";
    if (!name.trim()) return;
    const r = await api.post<{ id: string }>(m("/sites"), { name: name.trim() });
    await reload();
    setSite(r.id);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <select className="select" style={{ width: 220 }} value={site} onChange={(e) => setSite(e.target.value)} aria-label={t("mon.site")}>
          {sites.length === 0 && <option value="">{t("mon.noSites")}</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" style={{ width: 120 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label={t("mon.range")}>
          <option value="24h">24 h</option><option value="7d">7 d</option><option value="30d">30 d</option>
        </select>
        <div className="grow" />
        {manage && <button className="btn btn-sm" onClick={() => void add()}><I.IconPlus size={13} /> {t("mon.addSite")}</button>}
      </div>
      {cur && (
        <div className="card col" style={{ gap: 6 }}>
          <span className="small muted">{t("mon.snippetHint")}</span>
          <div className="code-snippet"><pre className="code-view small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{snippet}</pre><button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(snippet).then(() => toast(t("common.copied"), "success"))}><I.IconCopy size={13} /></button></div>
          <span className="hint">{t("mon.privacy")}</span>
        </div>
      )}
      {cur && !stats && <div className="muted">{t("common.loading")}</div>}
      {stats && (
        <>
          <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 160px), 1fr))", gap: 10 }}>
            {([[t("mon.views"), stats.totals.views], [t("mon.visitors"), stats.totals.visitors], [t("mon.errors"), stats.totals.errors], [t("mon.events"), stats.totals.events]] as const).map(([l, v]) => (
              <div key={l} className="card stat-tile"><div className="small muted">{l}</div><div className="stat-value">{v.toLocaleString()}</div></div>
            ))}
          </div>
          <div className="card col" style={{ gap: 8 }}>
            <strong>{t("mon.views")}</strong>
            <LineChart points={stats.series.map((s) => ({ t: range === "24h" ? s.t.slice(11) : s.t.slice(5, 10), v: s.views }))} label={t("mon.views")} />
          </div>
          <div className="card col" style={{ gap: 8 }}>
            <strong>{t("mon.vitals")}</strong>
            <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))", gap: 8 }}>
              {Object.keys(VITAL_THRESHOLDS).map((name) => {
                const v = stats.vitals.find((x) => x.name === name);
                const h = v ? vitalHealth(name, v.p75) : "none";
                return (
                  <div key={name} className="col" style={{ gap: 4 }}>
                    <span className="small muted">{name} · p75</span>
                    <strong style={{ fontSize: 20 }}>{v ? formatVital(name, v.p75) : "—"}</strong>
                    <HealthBadge health={h} label={h === "none" ? t("mon.noData") : t(`mon.v.${h}`)} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
            {([["mon.pages", stats.pages], ["mon.referrers", stats.referrers], ["mon.devices", stats.devices], ["mon.browsers", stats.browsers], ["mon.countries", stats.countries], ["mon.customEvents", stats.events]] as const).map(([k, items]) => (
              <div key={k} className="card col" style={{ gap: 8 }}><strong>{t(k)}</strong><BarList items={items} /></div>
            ))}
          </div>
          <div className="card col" style={{ gap: 8 }}>
            <strong>{t("mon.errorTracking")}</strong>
            {stats.errors.length === 0 ? <div className="hint">{t("mon.noErrors")}</div> : stats.errors.map((e) => (
              <div key={e.message}>
                <div className="list-item" onClick={() => setOpenErr(openErr === e.message ? null : e.message)}>
                  <I.IconBug size={14} style={{ color: "var(--mfc-danger)" }} />
                  <span className="grow ellipsis mono small">{e.message}</span>
                  <span className="badge badge-danger">{e.count}×</span>
                  <span className="small muted">{new Date(e.last).toLocaleString()}</span>
                </div>
                {openErr === e.message && <pre className="code-view small" style={{ whiteSpace: "pre-wrap" }}>{`${e.path ?? ""}\n${e.stack ?? "(no stack)"}`}</pre>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Alerts({ t, manage }: { t: (k: string, v?: Record<string, string | number>) => string; manage: boolean }) {
  const [list, setList] = useState<Channel[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [form, setForm] = useState<null | { name: string; kind: Channel["kind"]; config: Record<string, string>; secretId: string; events: string[] }>(null);
  const reload = () => {
    api.get<{ channels: Channel[]; events: string[] }>(m("/channels")).then((r) => (setList(r.channels), setEvents(r.events.filter((e) => e !== "test")))).catch(() => setList([]));
    vaultApi.list().then(setSecrets).catch(() => setSecrets([]));
  };
  useEffect(reload, []);
  const KIND_HELP: Record<Channel["kind"], { config: Array<[string, string]>; secret: string | null }> = {
    email: { config: [["to", "ops@example.com, me@example.com"]], secret: null },
    telegram: { config: [["chatId", "-1001234567890"]], secret: t("mon.secret.telegram") },
    slack: { config: [], secret: t("mon.secret.slack") },
    discord: { config: [], secret: t("mon.secret.discord") },
    webhook: { config: [["url", "https://example.com/hooks/alerts"]], secret: t("mon.secret.webhook") },
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    try {
      await api.post(m("/channels"), { ...form, secretId: form.secretId || null });
      setForm(null);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row"><strong className="grow">{t("mon.channels")}</strong>{manage && !form && <button className="btn btn-primary btn-sm" onClick={() => setForm({ name: "", kind: "telegram", config: {}, secretId: "", events: ["monitor.down", "monitor.up", "deploy.failed", "workflow.failed"] })}><I.IconPlus size={14} /> {t("mon.addChannel")}</button>}</div>
      {form && (
        <form className="card col" style={{ gap: 10 }} onSubmit={save}>
          <div className="row wrap" style={{ gap: 6 }}>{(["email", "telegram", "slack", "discord", "webhook"] as const).map((k) => <button type="button" key={k} className={`btn btn-sm ${form.kind === k ? "btn-primary" : ""}`} onClick={() => setForm({ ...form, kind: k, config: {} })}>{k}</button>)}</div>
          <input className="input" required placeholder={t("common.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {KIND_HELP[form.kind].config.map(([k, ph]) => <input key={k} className="input mono" required placeholder={ph} value={form.config[k] ?? ""} onChange={(e) => setForm({ ...form, config: { ...form.config, [k]: e.target.value } })} aria-label={k} />)}
          {KIND_HELP[form.kind].secret && (
            <label className="col" style={{ gap: 4 }}><span className="label">{KIND_HELP[form.kind].secret}</span>
              <select className="select" required={form.kind !== "webhook"} value={form.secretId} onChange={(e) => setForm({ ...form, secretId: e.target.value })}>
                <option value="">{t("data.pickSecret")}</option>
                {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
              </select></label>
          )}
          <div className="row wrap" style={{ gap: 10 }}>{events.map((ev) => <label key={ev} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={form.events.includes(ev)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })} /> {t(`mon.ev.${ev}`)}</label>)}</div>
          <div className="row"><button className="btn btn-primary">{t("common.save")}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t("common.cancel")}</button></div>
        </form>
      )}
      {list.length === 0 && !form && <div className="empty">{t("mon.noChannels")}</div>}
      {list.map((c) => (
        <div key={c.id} className="card row wrap" style={{ gap: 10 }}>
          <span className="badge">{c.kind}</span>
          <div className="grow col" style={{ minWidth: 0 }}><strong>{c.name}</strong><span className="small muted ellipsis">{c.events.map((e) => t(`mon.ev.${e}`)).join(" · ")}</span></div>
          {manage && <button className="btn btn-sm" onClick={() => void api.post<{ ok: boolean; message?: string }>(m(`/channels/${c.id}/test`)).then((r) => toast(r.ok ? t("mon.testSent") : r.message ?? "Failed", r.ok ? "success" : "error"))}><I.IconSend size={13} /> {t("deploy.test")}</button>}
          {manage && <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && api.del(m(`/channels/${c.id}`)).then(reload))}><I.IconTrash size={14} /></button>}
        </div>
      ))}
    </div>
  );
}

export default function MonitoringPage() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "uptime" | "analytics" | "alerts") ?? "uptime";
  const tabs: Array<[typeof tab, string, typeof I.IconHome]> = [["uptime", t("mon.tab.uptime"), I.IconMonitor], ["analytics", t("mon.tab.analytics"), I.IconChart], ["alerts", t("mon.tab.alerts"), I.IconBell]];
  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setParams({ tab: id })}><Icon size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{label}</button>)}
      </div>
      <div className="page">
        <div className="page-narrow">
          {tab === "uptime" && <Uptime t={t} manage={can(role, "monitoring.manage")} />}
          {tab === "analytics" && <Analytics t={t} manage={can(role, "monitoring.manage")} />}
          {tab === "alerts" && <Alerts t={t} manage={can(role, "notifications.manage")} />}
        </div>
      </div>
    </div>
  );
}
