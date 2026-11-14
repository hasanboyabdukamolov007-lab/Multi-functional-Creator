import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { COLUMN_TYPES, autoArrange, createSchemaSql, diffSql, duplicateTable, importSchema, isDbSchema, newColumn, newTable, starterSchema, validateSchema, type Column, type DbSchema, type Table } from "./sqlgen";
import { dataApi, type Connection } from "./dataApi";
import { createAutosave, projectsApi, type ProjectSummary } from "../../lib/projects";
import { ApiError } from "../../lib/api";
import { downloadText, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";
import { trackUnsaved } from "../../lib/guards";
import { ask, confirmDialog } from "../../ui/dialog";

const CARD_W = 240;
const ROW_H = 24;
const HEAD_H = 34;

function useDbProject(projectId: string | null) {
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<"saved" | "saving" | "dirty" | "conflict">("saved");
  const version = useRef(0);
  const saver = useRef(createAutosave(700));
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => (projectId ? trackUnsaved(`db:${projectId}`, () => stateRef.current === "dirty" || stateRef.current === "saving") : undefined), [projectId]);
  useEffect(() => () => void saver.current.flush(), []);
  useEffect(() => {
    if (!projectId) return;
    setSchema(null);
    projectsApi.get<DbSchema>(projectId).then((p) => {
      version.current = p.version;
      setName(p.name);
      setSchema(isDbSchema(p.data) ? p.data : starterSchema());
    });
  }, [projectId]);
  const update = (fn: (s: DbSchema) => DbSchema) => {
    setSchema((prev) => {
      if (!prev || !projectId) return prev;
      const next = fn(structuredClone(prev));
      if (state === "conflict") return next;
      setState("dirty");
      saver.current.schedule(async () => {
        setState("saving");
        try {
          version.current = (await projectsApi.save(projectId, { data: next, baseVersion: version.current })).version;
          setState("saved");
        } catch (e) {
          setState(e instanceof ApiError && e.status === 409 ? "conflict" : "dirty");
          toast((e as Error).message, "error");
        }
      });
      return next;
    });
  };
  return { schema, name, state, update };
}

function Picker() {
  const t = useT();
  const [, setParams] = useSearchParams();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    projectsApi.list("db").then(setList).catch(() => setList([]));
  }, []);
  const [conns, setConns] = useState<Connection[]>([]);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    dataApi.connections().then((c) => setConns(c.filter((x) => x.kind !== "mongodb"))).catch(() => setConns([]));
  }, []);
  const create = async () => {
    const name = (await ask(t("data.schemaName"), "App database"))?.trim();
    if (!name) return;
    const p = await projectsApi.create(name, "db", starterSchema());
    setParams({ tab: "schema", project: p.id });
  };
  const importFrom = async (id: string) => {
    const c = conns.find((x) => x.id === id);
    if (!c) return;
    setImporting(true);
    try {
      const schema = importSchema(await dataApi.schema(c.id), c.kind === "mysql" ? "mysql" : "postgres");
      const p = await projectsApi.create(`${c.name} schema`, "db", schema);
      toast(t("data.imported", { n: schema.tables.length }), "success");
      setParams({ tab: "schema", project: p.id });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setImporting(false);
    }
  };
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t("data.tab.schema")}</h2>
            <p className="page-subtitle">{t("data.schemaIntro")}</p>
          </div>
          <div className="row wrap">
            {conns.length > 0 && (
              <select className="select" style={{ width: 230 }} value="" disabled={importing} onChange={(e) => e.target.value && void importFrom(e.target.value)} aria-label={t("data.importFromDb")}>
                <option value="">{importing ? t("common.loading") : `⤓ ${t("data.importFromDb")}`}</option>
                {conns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
              </select>
            )}
            <button className="btn btn-primary" onClick={() => void create()}><I.IconPlus size={15} /> {t("data.newSchema")}</button>
          </div>
        </div>
        {list === null ? <div className="muted">{t("common.loading")}</div> : list.length === 0 ? <div className="empty">{t("data.noSchemas")}</div> : (
          <div className="grid-auto">
            {list.map((p) => (
              <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setParams({ tab: "schema", project: p.id })}>
                <div className="card-title">{p.name}</div>
                <div className="small muted">{t("data.tab.schema")}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnRow({ c, tables, onChange, onRemove }: { c: Column; tables: Table[]; onChange: (c: Column) => void; onRemove: () => void }) {
  const refTargets = tables.flatMap((tb) => tb.columns.filter((x) => x.pk || x.unique).map((x) => `${tb.name}.${x.name}`));
  return (
    <div className="card col" style={{ gap: 6, padding: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input input-sm mono grow" value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })} aria-label="Column name" />
        <select className="select input-sm" style={{ width: 110 }} value={c.type} onChange={(e) => onChange({ ...c, type: e.target.value as Column["type"] })} aria-label="Type">
          {COLUMN_TYPES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="icon-btn" aria-label="Remove column" onClick={onRemove}><I.IconTrash size={13} /></button>
      </div>
      <div className="row wrap small" style={{ gap: 10 }}>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={c.pk} onChange={(e) => onChange({ ...c, pk: e.target.checked, nullable: e.target.checked ? false : c.nullable })} /> PK</label>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!c.nullable} disabled={c.pk} onChange={(e) => onChange({ ...c, nullable: !e.target.checked })} /> not null</label>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={c.unique} disabled={c.pk} onChange={(e) => onChange({ ...c, unique: e.target.checked })} /> unique</label>
        {c.type === "varchar" && <input className="input input-sm" style={{ width: 70 }} type="number" min={1} value={c.length ?? 255} onChange={(e) => onChange({ ...c, length: Number(e.target.value) })} aria-label="Length" />}
      </div>
      <input className="input input-sm mono" placeholder="default (e.g. now(), 0, 'draft')" value={c.default ?? ""} onChange={(e) => onChange({ ...c, default: e.target.value })} aria-label="Default" />
      <div className="row" style={{ gap: 6 }}>
        <select className="select input-sm grow" value={c.references ? `${c.references.table}.${c.references.column}` : ""} onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange({ ...c, references: null });
          const [table, column] = v.split(".");
          onChange({ ...c, references: { table, column, onDelete: c.references?.onDelete ?? "cascade" } });
        }} aria-label="References">
          <option value="">no foreign key</option>
          {refTargets.map((r) => <option key={r} value={r}>→ {r}</option>)}
        </select>
        {c.references && (
          <select className="select input-sm" style={{ width: 110 }} value={c.references.onDelete} onChange={(e) => onChange({ ...c, references: { ...c.references!, onDelete: e.target.value as "cascade" } })} aria-label="On delete">
            <option value="cascade">cascade</option>
            <option value="restrict">restrict</option>
            <option value="set null">set null</option>
          </select>
        )}
      </div>
    </div>
  );
}

function Editor({ projectId }: { projectId: string }) {
  const t = useT();
  const { schema, name, state, update } = useDbProject(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [sqlTab, setSqlTab] = useState<"create" | "migration">("create");
  const [conns, setConns] = useState<Connection[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dataApi.connections().then((c) => setConns(c.filter((x) => x.kind !== "mongodb"))).catch(() => setConns([]));
  }, []);

  const problems = useMemo(() => (schema ? validateSchema(schema) : []), [schema]);
  const createSql = useMemo(() => (schema && !problems.length ? createSchemaSql(schema) : ""), [schema, problems]);
  const migration = useMemo(() => (schema && !problems.length ? diffSql(schema.applied?.tables ?? [], schema.tables, schema.dialect) : []), [schema, problems]);
  if (!schema) return <div className="page muted">{t("common.loading")}</div>;
  const table = schema.tables.find((x) => x.id === selected) ?? null;
  const setTable = (id: string, fn: (tb: Table) => Table) => update((s) => ({ ...s, tables: s.tables.map((x) => (x.id === id ? fn(x) : x)) }));

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - r.left + canvas.current.scrollLeft - drag.current.dx));
    const y = Math.max(0, Math.round(e.clientY - r.top + canvas.current.scrollTop - drag.current.dy));
    const id = drag.current.id;
    update((s) => ({ ...s, tables: s.tables.map((tb) => (tb.id === id ? { ...tb, x, y } : tb)) }));
  };

  const lines = schema.tables.flatMap((tb) =>
    tb.columns.flatMap((c, ci) => {
      const target = c.references && schema.tables.find((x) => x.name === c.references!.table);
      if (!target) return [];
      const ti = target.columns.findIndex((x) => x.name === c.references!.column);
      const y1 = tb.y + HEAD_H + ci * ROW_H + ROW_H / 2;
      const y2 = target.y + HEAD_H + Math.max(0, ti) * ROW_H + ROW_H / 2;
      const fromRight = target.x > tb.x;
      const x1 = fromRight ? tb.x + CARD_W : tb.x;
      const x2 = fromRight ? target.x : target.x + CARD_W;
      const mid = (x1 + x2) / 2;
      return [{ key: `${tb.id}-${c.id}`, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}` }];
    }),
  );
  const width = Math.max(900, ...schema.tables.map((tb) => tb.x + CARD_W + 80));
  const height = Math.max(520, ...schema.tables.map((tb) => tb.y + HEAD_H + tb.columns.length * ROW_H + 80));

  const applyTo = async (id: string) => {
    const target = conns.find((x) => x.id === id);
    if (!target) return;
    if (!(await confirmDialog(t("data.applyConfirm", { n: migration.length, name: target.name }), { body: migration.join("\n\n").slice(0, 1200), danger: true, ok: t("data.applyToDb") }))) return;
    try {
      for (const stmt of migration) await dataApi.query(target.id, { sql: stmt, readOnly: false });
      update((s) => ({ ...s, applied: { tables: structuredClone(s.tables), at: new Date().toISOString() } }));
      toast(t("data.applied", { n: migration.length }), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="toolbar">
        <strong style={{ padding: "0 6px" }}>{name}</strong>
        <span className="small muted" style={{ minWidth: 70 }}>{state === "saving" ? t("common.saving") : state === "saved" ? t("common.saved") : state === "conflict" ? "⚠ Conflict — reload" : "•"}</span>
        <div className="toolbar-sep" />
        <button className="btn btn-sm" onClick={() => update((s) => {
          const tb = newTable(`table_${s.tables.length + 1}`, 40 + (s.tables.length % 3) * 280, 40 + Math.floor(s.tables.length / 3) * 260);
          setSelected(tb.id);
          return { ...s, tables: [...s.tables, tb] };
        })}><I.IconPlus size={14} /> {t("data.addTable")}</button>
        <button className="btn btn-sm btn-ghost" title={t("data.arrange")} onClick={() => update((s) => autoArrange(s))}><I.IconGrid size={14} /> {t("data.arrange")}</button>
        <select className="select input-sm" style={{ width: 130 }} value={schema.dialect} onChange={(e) => update((s) => ({ ...s, dialect: e.target.value as DbSchema["dialect"] }))} aria-label="Dialect">
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
        </select>
        <div className="grow" />
        {problems.length > 0 ? <span className="badge badge-warning" title={problems.join("\n")}><I.IconWarning size={12} /> {problems.length}</span> : <span className="badge badge-success"><I.IconCheck size={12} /> valid</span>}
        <button className="btn btn-sm" disabled={!createSql} onClick={() => downloadText(`${slugify(name)}.sql`, createSql, "application/sql")}><I.IconDownload size={14} /> .sql</button>
        <select className="select input-sm" style={{ width: 150 }} value="" disabled={!migration.length || !conns.some((c) => c.kind === (schema.dialect === "mysql" ? "mysql" : "postgres"))} onChange={(e) => e.target.value && void applyTo(e.target.value)} aria-label={t("data.applyToDb")} title={t("data.applyToDb")}>
          <option value="">🚀 {t("data.applyToDb")}…</option>
          {conns.filter((c) => c.kind === (schema.dialect === "mysql" ? "mysql" : "postgres")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn btn-sm btn-ghost" disabled={!migration.length} onClick={() => update((s) => ({ ...s, applied: { tables: structuredClone(s.tables), at: new Date().toISOString() } }))}>{t("data.markApplied")}</button>
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: "stretch", gap: 0 }}>
        <div ref={canvas} className="schema-canvas grow" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
            {lines.map((l) => <path key={l.key} d={l.d} fill="none" stroke="var(--mfc-accent)" strokeWidth={2} opacity={0.7} />)}
          </svg>
          <div style={{ position: "relative", width, height }}>
            {schema.tables.map((tb) => (
              <div key={tb.id} className={`schema-card ${selected === tb.id ? "selected" : ""}`} style={{ left: tb.x, top: tb.y, width: CARD_W }} onClick={() => setSelected(tb.id)}>
                <div className="schema-head" onPointerDown={(e) => {
                  const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                  drag.current = { id: tb.id, dx: e.clientX - r.left, dy: e.clientY - r.top };
                  setSelected(tb.id);
                }}>
                  <I.IconGrip size={13} /> <span className="mono">{tb.name}</span>
                </div>
                {tb.columns.map((c) => (
                  <div key={c.id} className="schema-row">
                    <span className="mono ellipsis">{c.pk ? "🔑 " : c.references ? "↗ " : ""}{c.name}</span>
                    <span className="muted">{c.type}{c.nullable ? "?" : ""}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <aside className="panel" style={{ width: 340, borderLeft: "1px solid var(--mfc-border)" }}>
          <div className="tabs">
            <button className={`tab ${table ? "active" : ""}`} disabled={!table}>{t("data.table")}</button>
            <button className={`tab ${!table && sqlTab === "create" ? "active" : ""}`} onClick={() => (setSelected(null), setSqlTab("create"))}>SQL</button>
            <button className={`tab ${!table && sqlTab === "migration" ? "active" : ""}`} onClick={() => (setSelected(null), setSqlTab("migration"))}>{t("data.migration")} {migration.length ? `(${migration.length})` : ""}</button>
          </div>
          <div className="panel-body" style={{ padding: 10 }}>
            {table ? (
              <div className="col" style={{ gap: 8 }}>
                <div className="row">
                  <input className="input mono grow" value={table.name} onChange={(e) => setTable(table.id, (tb) => ({ ...tb, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") }))} aria-label="Table name" />
                  <button className="icon-btn" aria-label={t("data.duplicate")} title={t("data.duplicate")} onClick={() => update((s) => { const c = duplicateTable(s, table.id); if (c) setSelected(c.id); return c ? { ...s, tables: [...s.tables, c] } : s; })}><I.IconCopy size={15} /></button>
                  <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && (update((s) => ({ ...s, tables: s.tables.filter((x) => x.id !== table.id) })), setSelected(null)))}><I.IconTrash size={15} /></button>
                </div>
                {table.columns.map((c) => (
                  <ColumnRow key={c.id} c={c} tables={schema.tables} onChange={(nc) => setTable(table.id, (tb) => ({ ...tb, columns: tb.columns.map((x) => (x.id === nc.id ? nc : x)) }))} onRemove={() => setTable(table.id, (tb) => ({ ...tb, columns: tb.columns.filter((x) => x.id !== c.id) }))} />
                ))}
                <button className="btn btn-sm" onClick={() => setTable(table.id, (tb) => ({ ...tb, columns: [...tb.columns, newColumn({ name: `column_${tb.columns.length + 1}` })] }))}><I.IconPlus size={13} /> {t("data.addColumn")}</button>
              </div>
            ) : problems.length ? (
              <div className="col" style={{ gap: 6 }}>{problems.map((p) => <div key={p} className="badge badge-warning" style={{ whiteSpace: "normal" }}>{p}</div>)}</div>
            ) : sqlTab === "create" ? (
              <pre className="code-view">{createSql}</pre>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <p className="hint">{schema.applied ? t("data.migrationSince", { when: new Date(schema.applied.at).toLocaleString() }) : t("data.migrationNever")}</p>
                <pre className="code-view">{migration.length ? migration.join("\n\n") : "-- No changes"}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function SchemaDesigner() {
  const [params] = useSearchParams();
  const project = params.get("project");
  return project ? <Editor key={project} projectId={project} /> : <Picker />;
}
