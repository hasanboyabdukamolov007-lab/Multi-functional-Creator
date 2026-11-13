import { useEffect, useState } from "react";
import { can } from "@mfc/core";
import { dataApi, toCsv, type Connection, type QueryResult, type SchemaTable } from "./dataApi";
import { vaultApi, type SecretMeta } from "../vault/vaultApi";
import { useBuilder } from "../builder/store";
import { n } from "../builder/model";
import { useSession } from "../../lib/session";
import { downloadText } from "../../lib/download";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import { runFunction } from "../../lib/registry";
import * as I from "../../ui/icons";

const MONGO_TEMPLATE = JSON.stringify({ collection: "users", op: "find", filter: {}, limit: 50 }, null, 2);

export default function DataBrowser() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const [conns, setConns] = useState<Connection[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [active, setActive] = useState<Connection | null>(null);
  const [schema, setSchema] = useState<SchemaTable[] | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "postgres" as Connection["kind"], secretId: "" });
  const builderOpen = useBuilder((s) => !!s.projectId);

  const reload = () => {
    dataApi.connections().then(setConns).catch(() => setConns([]));
    vaultApi.list().then(setSecrets).catch(() => setSecrets([]));
  };
  useEffect(reload, []);

  const select = (c: Connection) => {
    setActive(c);
    setResult(null);
    setError(null);
    setSchema(null);
    setSchemaError(null);
    setQuery(c.kind === "mongodb" ? MONGO_TEMPLATE : "SELECT 1;");
    dataApi.schema(c.id).then(setSchema).catch((e: Error) => setSchemaError(e.message));
  };

  const run = async () => {
    if (!active) return;
    if (!readOnly && !window.confirm(t("data.writeConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      let mongo: unknown;
      if (active.kind === "mongodb") mongo = JSON.parse(query);
      setResult(await dataApi.query(active.id, active.kind === "mongodb" ? { mongo, readOnly } : { sql: query, readOnly }));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = (table: string) => {
    if (!active) return;
    if (active.kind === "mongodb") setQuery(JSON.stringify({ collection: table, op: "find", filter: {}, limit: 100 }, null, 2));
    else {
      const qi = (s: string) => (active.kind === "mysql" ? `\`${s}\`` : s.split(".").map((p) => `"${p}"`).join("."));
      setQuery(`SELECT * FROM ${qi(table)} LIMIT 100;`);
    }
  };

  const addConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dataApi.addConnection(form);
      setAdding(false);
      setForm({ name: "", kind: "postgres", secretId: "" });
      reload();
      toast(t("data.connectionAdded"), "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const insertTable = () => {
    if (!result) return;
    const clean = (v: unknown) => String(v ?? "").replace(/[,\n]/g, " ").slice(0, 80);
    useBuilder.getState().insert(n("table", { columns: result.columns.map(clean).join(", "), rows: result.rows.slice(0, 100).map((r) => r.map(clean).join(", ")).join("\n"), striped: true }));
    toast(t("data.insertedTable", { rows: Math.min(100, result.rows.length) }), "success");
  };

  return (
    <div className="data-split">
      <aside className="panel data-side">
        <div className="panel-header">
          <span className="grow">{t("data.connections")}</span>
          {can(role, "data.connect") && <button className="icon-btn" title={t("data.addConnection")} onClick={() => setAdding(!adding)}><I.IconPlus size={15} /></button>}
        </div>
        <div className="panel-body" style={{ padding: 6 }}>
          {adding && (
            <form className="card col" style={{ gap: 8, padding: 10, marginBottom: 8 }} onSubmit={addConnection}>
              <input className="input input-sm" required placeholder={t("common.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="select input-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Connection["kind"] })}>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="mongodb">MongoDB</option>
              </select>
              <select className="select input-sm" required value={form.secretId} onChange={(e) => setForm({ ...form, secretId: e.target.value })}>
                <option value="">{t("data.pickSecret")}</option>
                {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
              </select>
              <p className="hint">{t("data.connHint")}</p>
              <div className="row">
                <button className="btn btn-primary btn-sm">{t("common.create")}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => runFunction("vault.new")}>{t("vault.newSecret")}</button>
              </div>
            </form>
          )}
          {conns.length === 0 && !adding && <div className="hint" style={{ padding: 8 }}>{t("data.noConnections")}</div>}
          {conns.map((c) => (
            <div key={c.id}>
              <div className={`list-item ${active?.id === c.id ? "selected" : ""}`} onClick={() => select(c)}>
                <I.IconData size={14} className="muted" />
                <span className="grow ellipsis">{c.name}</span>
                <span className="badge">{c.kind}</span>
                {can(role, "data.connect") && <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={t("common.delete")} onClick={(e) => { e.stopPropagation(); if (window.confirm(t("common.confirm"))) void dataApi.removeConnection(c.id).then(() => (setActive(null), reload())); }}><I.IconTrash size={12} /></button>}
              </div>
              {active?.id === c.id && (
                <div style={{ paddingLeft: 14 }}>
                  {schemaError && <div className="small" style={{ color: "var(--mfc-danger)", padding: 6 }}>{schemaError}</div>}
                  {!schema && !schemaError && <div className="small muted" style={{ padding: 6 }}>{t("common.loading")}</div>}
                  {schema?.map((tb) => (
                    <div key={tb.name}>
                      <div className="list-item small" onClick={() => setOpen({ ...open, [tb.name]: !open[tb.name] })} onDoubleClick={() => preview(tb.name)} title={t("data.previewHint")}>
                        {open[tb.name] ? <I.IconChevronDown size={12} /> : <I.IconChevronRight size={12} />}
                        <span className="grow ellipsis mono">{tb.name}</span>
                        <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Preview rows" onClick={(e) => (e.stopPropagation(), preview(tb.name))}><I.IconPlay size={11} /></button>
                      </div>
                      {open[tb.name] && tb.columns.map((col) => (
                        <div key={col.name} className="row small" style={{ paddingLeft: 26, gap: 6 }}>
                          <span className="mono">{col.name}</span>
                          <span className="muted">{col.type}{col.nullable ? "" : " · not null"}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
      <section className="col grow" style={{ gap: 10, padding: 16, minWidth: 0, overflow: "auto" }}>
        {!active ? (
          <div className="empty">{t("data.pickConnection")}</div>
        ) : (
          <>
            <textarea className="textarea mono" rows={8} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), void run())} spellCheck={false} aria-label="Query" />
            <div className="row wrap">
              <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconPlay size={14} />} {t("data.run")} <kbd>Ctrl ↵</kbd></button>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> {t("data.readOnly")}
              </label>
              {!readOnly && <span className="badge badge-warning">{t("data.writesEnabled")}</span>}
              <div className="grow" />
              {result && (
                <>
                  <span className="small muted">{result.rowCount} {t("data.rows")} · {result.ms} ms{result.truncated ? ` · ${t("data.truncated")}` : ""}</span>
                  <button className="btn btn-sm" onClick={() => downloadText("query.csv", toCsv(result.columns, result.rows), "text/csv")}>CSV</button>
                  <button className="btn btn-sm" onClick={() => downloadText("query.json", JSON.stringify(result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))), null, 2), "application/json")}>JSON</button>
                  <button className="btn btn-sm" disabled={!builderOpen || !result.columns.length} onClick={insertTable} title={builderOpen ? "" : t("builder.openProject")}><I.IconBuilder size={13} /> {t("data.insertTable")}</button>
                </>
              )}
            </div>
            {error && <div className="badge badge-danger" style={{ whiteSpace: "normal", padding: "8px 10px" }}>{error}</div>}
            {result && (
              <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: "60vh" }}>
                <table className="table result-grid">
                  <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i}>{r.map((v, j) => <td key={j} className="mono small" title={typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}>{v === null ? <span className="muted">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
