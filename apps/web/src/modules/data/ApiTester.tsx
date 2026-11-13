import { useEffect, useMemo, useState } from "react";
import { ENVIRONMENTS, type Environment } from "@mfc/core";
import { httpApi, toTable, curlFor, fetchFor, type HttpReq, type HttpRes, type SavedRequest } from "./dataApi";
import { useBuilder } from "../builder/store";
import { n } from "../builder/model";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import { ApiError } from "../../lib/api";
import * as I from "../../ui/icons";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const BLANK: HttpReq = { method: "GET", url: "https://jsonplaceholder.typicode.com/users", headers: { Accept: "application/json" }, body: "", environment: "development" };

function HeadersEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const rows = [...Object.entries(value), ["", ""] as [string, string]];
  const set = (i: number, k: string, v: string) => {
    const next = rows.slice(0, -1).map(([a, b], j) => (j === i ? [k, v] : [a, b]) as [string, string]);
    if (i === rows.length - 1 && (k || v)) next.push([k, v]);
    onChange(Object.fromEntries(next.filter(([a]) => a.trim() || false)));
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      {rows.map(([k, v], i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <input className="input input-sm mono" style={{ flex: "0 0 38%" }} placeholder="Header" value={k} onChange={(e) => set(i, e.target.value, v)} aria-label="Header name" />
          <input className="input input-sm mono grow" placeholder="Value — use {{ secrets.NAME }} for vault values" value={v} onChange={(e) => set(i, k, e.target.value)} aria-label="Header value" />
          {i < rows.length - 1 && <button className="icon-btn" aria-label="Remove header" onClick={() => onChange(Object.fromEntries(rows.slice(0, -1).filter((_, j) => j !== i)))}><I.IconClose size={13} /></button>}
        </div>
      ))}
    </div>
  );
}

export default function ApiTester() {
  const t = useT();
  const [saved, setSaved] = useState<SavedRequest[]>([]);
  const [current, setCurrent] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  const [req, setReq] = useState<HttpReq>(BLANK);
  const [res, setRes] = useState<HttpRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"headers" | "body" | "code">("headers");
  const [resTab, setResTab] = useState<"body" | "headers">("body");
  const builderOpen = useBuilder((s) => !!s.projectId);

  const reload = () => httpApi.list().then(setSaved).catch(() => setSaved([]));
  useEffect(() => {
    void reload();
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await httpApi.send(req));
    } catch (e) {
      setRes(null);
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (asNew: boolean) => {
    const name = asNew || !current.id ? window.prompt(t("data.requestName"), current.name || `${req.method} ${req.url.replace(/^https?:\/\//, "").slice(0, 40)}`)?.trim() : current.name;
    if (!name) return;
    try {
      if (current.id && !asNew) await httpApi.update(current.id, { ...req, name });
      else setCurrent({ id: (await httpApi.create({ ...req, name })).id, name });
      toast(t("common.saved"), "success");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const parsed = useMemo(() => {
    if (!res) return null;
    try {
      return JSON.parse(res.body) as unknown;
    } catch {
      return undefined;
    }
  }, [res]);
  const table = parsed !== undefined && parsed !== null ? toTable(parsed) : null;
  const statusTone = !res ? "" : res.status < 300 ? "badge-success" : res.status < 400 ? "badge-accent" : "badge-danger";

  const insertTable = () => {
    if (!table) return;
    const clean = (s: string) => s.replace(/[,\n]/g, " ").slice(0, 80);
    useBuilder.getState().insert(n("table", { columns: table.columns.map(clean).join(", "), rows: table.rows.map((r) => r.map(clean).join(", ")).join("\n"), striped: true }));
    toast(t("data.insertedTable", { rows: table.rows.length }), "success");
  };

  return (
    <div className="data-split">
      <aside className="panel data-side">
        <div className="panel-header">
          <span className="grow">{t("data.saved")}</span>
          <button className="icon-btn" title={t("common.new")} onClick={() => (setCurrent({ id: null, name: "" }), setReq(BLANK), setRes(null))}><I.IconPlus size={15} /></button>
        </div>
        <div className="panel-body" style={{ padding: 6 }}>
          {saved.length === 0 && <div className="hint" style={{ padding: 8 }}>{t("data.noSaved")}</div>}
          {saved.map((s) => (
            <div key={s.id} className={`list-item ${current.id === s.id ? "selected" : ""}`} onClick={() => (setCurrent({ id: s.id, name: s.name }), setReq({ method: s.method, url: s.url, headers: s.headers, body: s.body, environment: s.environment }), setRes(null))}>
              <span className={`badge method-${s.method.toLowerCase()}`}>{s.method}</span>
              <span className="grow ellipsis">{s.name}</span>
              <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={t("common.delete")} onClick={(e) => { e.stopPropagation(); if (window.confirm(t("common.confirm"))) void httpApi.remove(s.id).then(reload); }}><I.IconTrash size={12} /></button>
            </div>
          ))}
        </div>
      </aside>
      <section className="col grow" style={{ gap: 12, padding: 16, minWidth: 0, overflow: "auto" }}>
        <div className="row" style={{ gap: 6 }}>
          <select className="select" style={{ width: 110 }} value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value })} aria-label="Method">
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input className="input mono grow" value={req.url} onChange={(e) => setReq({ ...req, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void send()} placeholder="https://api.example.com/v1/items" aria-label="URL" />
          <select className="select" style={{ width: 140 }} value={req.environment} onChange={(e) => setReq({ ...req, environment: e.target.value as Environment })} title={t("data.secretEnv")} aria-label={t("data.secretEnv")}>
            {ENVIRONMENTS.map((e) => <option key={e} value={e}>{t(`vault.env.${e}`)}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy || !req.url.trim()} onClick={() => void send()}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconSend size={14} />} {t("data.send")}</button>
          <button className="btn" onClick={() => void save(false)}><I.IconSave size={14} /> {t("common.save")}</button>
          {current.id && <button className="btn btn-ghost" onClick={() => void save(true)}>{t("data.saveAs")}</button>}
        </div>
        <div className="tabs" style={{ padding: 0 }}>
          {(["headers", "body", "code"] as const).map((k) => <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{t(`data.tab.${k}`)}{k === "headers" && Object.keys(req.headers).length ? ` (${Object.keys(req.headers).length})` : ""}</button>)}
        </div>
        {tab === "headers" && <HeadersEditor value={req.headers} onChange={(headers) => setReq({ ...req, headers })} />}
        {tab === "body" && <textarea className="textarea mono" rows={8} value={req.body} disabled={["GET", "HEAD"].includes(req.method)} placeholder={'{\n  "name": "Ada",\n  "token": "{{ secrets.API_TOKEN }}"\n}'} onChange={(e) => setReq({ ...req, body: e.target.value })} spellCheck={false} />}
        {tab === "code" && (
          <div className="col" style={{ gap: 8 }}>
            <pre className="code-view">{curlFor(req)}</pre>
            <pre className="code-view">{fetchFor(req)}</pre>
            <p className="hint">{t("data.codeHint")}</p>
          </div>
        )}
        <p className="hint">{t("data.secretHint")}</p>

        {error && <div className="badge badge-danger" style={{ whiteSpace: "normal", padding: "8px 10px" }}>{error}</div>}
        {res && (
          <div className="card col" style={{ gap: 10, padding: 0 }}>
            <div className="row wrap" style={{ padding: "10px 14px", borderBottom: "1px solid var(--mfc-border)" }}>
              <span className={`badge ${statusTone}`}>{res.status} {res.statusText}</span>
              <span className="small muted">{res.ms} ms · {(res.size / 1024).toFixed(1)} KB{res.redirects ? ` · ${res.redirects} redirect(s)` : ""}{res.truncated ? " · truncated at 2 MB" : ""}</span>
              <div className="grow" />
              <div className="tabs" style={{ border: 0, padding: 0 }}>
                <button className={`tab ${resTab === "body" ? "active" : ""}`} onClick={() => setResTab("body")}>{t("data.tab.body")}</button>
                <button className={`tab ${resTab === "headers" ? "active" : ""}`} onClick={() => setResTab("headers")}>{t("data.tab.headers")}</button>
              </div>
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(res.body).then(() => toast(t("common.copied"), "success"))}><I.IconCopy size={13} /></button>
              {table && <button className="btn btn-sm" disabled={!builderOpen} title={builderOpen ? "" : t("builder.openProject")} onClick={insertTable}><I.IconBuilder size={13} /> {t("data.insertTable")}</button>}
            </div>
            {resTab === "body" ? (
              <pre className="code-view" style={{ margin: 0, border: 0, borderRadius: 0, maxHeight: 480 }}>{parsed !== undefined ? JSON.stringify(parsed, null, 2) : res.body || "(empty)"}</pre>
            ) : (
              <table className="table"><tbody>{Object.entries(res.headers).map(([k, v]) => <tr key={k}><td className="mono small">{k}</td><td className="mono small" style={{ wordBreak: "break-all" }}>{v}</td></tr>)}</tbody></table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
