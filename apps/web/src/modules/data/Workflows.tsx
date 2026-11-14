import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, ENVIRONMENTS, type Environment } from "@mfc/core";
import { CRON_PRESETS, NODE_TYPES, OPS, newNode, removeNode, validateGraph, workflowApi, type NodeType, type WfGraph, type WfNode, type WfRun, type Workflow } from "./workflowApi";
import { useSession } from "../../lib/session";
import { toast, copyText } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";
import { ask, confirmDialog } from "../../ui/dialog";

const NODE_W = 200;
const NODE_H = 64;
const TYPE_COLOR: Record<NodeType, string> = {
  trigger: "#8b5cf6",
  http: "#0ea5e9",
  condition: "#f59e0b",
  set: "#14b8a6",
  delay: "#64748b",
  email: "#ec4899",
  log: "#22c55e",
  transform: "#6366f1",
};

function summary(n: WfNode): string {
  const c = n.config;
  switch (n.type) {
    case "trigger": return c.mode === "schedule" ? `cron ${String(c.cron ?? "")}` : String(c.mode ?? "manual");
    case "http": return `${String(c.method ?? "GET")} ${String(c.url ?? "").replace(/^https?:\/\//, "")}`;
    case "condition": return `${String(c.left ?? "")} ${String(c.op ?? "")} ${String(c.right ?? "")}`;
    case "set": return Object.keys((c.vars as object) ?? {}).join(", ");
    case "delay": return `${Number(c.seconds ?? 0)} s`;
    case "email": return `→ ${String(c.to ?? "")}`;
    case "log": return String(c.message ?? "");
    case "transform": return String(c.template ?? "");
  }
}

function KeyValues({ value, onChange, placeholder }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; placeholder: [string, string] }) {
  const rows = [...Object.entries(value ?? {}), ["", ""] as [string, string]];
  const set = (i: number, k: string, v: string) => {
    const next = rows.map(([a, b], j) => (j === i ? [k, v] : [a, b]) as [string, string]);
    onChange(Object.fromEntries(next.filter(([a]) => a.trim())));
  };
  return (
    <div className="col" style={{ gap: 4 }}>
      {rows.map(([k, v], i) => (
        <div key={i} className="row" style={{ gap: 4 }}>
          <input className="input input-sm mono" style={{ flex: "0 0 40%" }} placeholder={placeholder[0]} value={k} onChange={(e) => set(i, e.target.value, v)} />
          <input className="input input-sm mono grow" placeholder={placeholder[1]} value={v} onChange={(e) => set(i, k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="col" style={{ gap: 4 }}><span className="label">{label}</span>{children}</label>;
}

function Inspector({ node, graph, wf, onChange, onRemove, onRotate }: { node: WfNode; graph: WfGraph; wf: Workflow; onChange: (n: WfNode) => void; onRemove: () => void; onRotate: () => void }) {
  const t = useT();
  const c = node.config;
  const set = (patch: Record<string, unknown>) => onChange({ ...node, config: { ...c, ...patch } });
  const others = graph.nodes.filter((x) => x.id !== node.id && x.type !== "trigger");
  const link = (key: "next" | "onTrue" | "onFalse", label: string) => (
    <Field label={label}>
      <select className="select input-sm" value={node[key] ?? ""} onChange={(e) => onChange({ ...node, [key]: e.target.value || null })}>
        <option value="">— {t("data.wf.end")} —</option>
        {others.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.type})</option>)}
      </select>
    </Field>
  );
  const str = (k: string) => String(c[k] ?? "");
  const hookUrl = `${location.origin}${wf.webhookPath}`;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <span className="badge" style={{ background: TYPE_COLOR[node.type], color: "#fff" }}>{node.type}</span>
        <div className="grow" />
        {node.type !== "trigger" && <button className="icon-btn" aria-label={t("common.delete")} onClick={onRemove}><I.IconTrash size={14} /></button>}
      </div>
      <Field label={t("data.wf.stepName")}>
        <input className="input input-sm mono" value={node.name} onChange={(e) => onChange({ ...node, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) })} />
      </Field>
      {node.type === "trigger" && (
        <>
          <Field label={t("data.wf.mode")}>
            <select className="select input-sm" value={str("mode") || "manual"} onChange={(e) => set({ mode: e.target.value, cron: e.target.value === "schedule" ? str("cron") || "0 9 * * *" : c.cron })}>
              <option value="manual">{t("data.wf.manual")}</option>
              <option value="webhook">{t("data.wf.webhook")}</option>
              <option value="schedule">{t("data.wf.schedule")}</option>
            </select>
          </Field>
          {c.mode === "schedule" && (
            <>
              <Field label="Cron (UTC)"><input className="input input-sm mono" value={str("cron")} onChange={(e) => set({ cron: e.target.value })} placeholder="m h dom mon dow" /></Field>
              <div className="row wrap" style={{ gap: 4 }}>{CRON_PRESETS.map(([expr, label]) => <button key={expr} className="chip" onClick={() => set({ cron: expr })}>{label}</button>)}</div>
              {wf.nextRun && wf.enabled && <p className="hint">{t("data.wf.nextRun", { when: new Date(wf.nextRun).toLocaleString() })}</p>}
            </>
          )}
          {c.mode === "webhook" && (
            <div className="col" style={{ gap: 6 }}>
              <pre className="code-view small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>POST {hookUrl}</pre>
              <div className="row">
                <button className="btn btn-sm" onClick={() => void copyText(hookUrl, t("common.copied"))}><I.IconCopy size={13} /> {t("common.copy")}</button>
                <button className="btn btn-sm btn-ghost" onClick={onRotate}><I.IconRotate size={13} /> {t("data.wf.rotate")}</button>
              </div>
              <p className="hint">{t("data.wf.webhookHint")}</p>
            </div>
          )}
        </>
      )}
      {node.type === "http" && (
        <>
          <div className="row" style={{ gap: 4 }}>
            <select className="select input-sm" style={{ width: 90 }} value={str("method") || "GET"} onChange={(e) => set({ method: e.target.value })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <input className="input input-sm mono grow" value={str("url")} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/items" aria-label="URL" />
          </div>
          <Field label={t("data.tab.headers")}><KeyValues value={c.headers as Record<string, string>} onChange={(headers) => set({ headers })} placeholder={["Authorization", "Bearer {{ secrets.API_TOKEN }}"]} /></Field>
          {!["GET", "DELETE"].includes(str("method")) && <Field label={t("data.tab.body")}><textarea className="textarea mono small" rows={4} value={str("body")} onChange={(e) => set({ body: e.target.value })} /></Field>}
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={c.failOnError !== false} onChange={(e) => set({ failOnError: e.target.checked })} /> {t("data.wf.failOnError")}</label>
        </>
      )}
      {node.type === "condition" && (
        <>
          <Field label={t("data.wf.left")}><input className="input input-sm mono" value={str("left")} onChange={(e) => set({ left: e.target.value })} /></Field>
          <Field label={t("data.wf.op")}>
            <select className="select input-sm" value={str("op")} onChange={(e) => set({ op: e.target.value })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
          </Field>
          {!["exists", "truthy"].includes(str("op")) && <Field label={t("data.wf.right")}><input className="input input-sm mono" value={str("right")} onChange={(e) => set({ right: e.target.value })} /></Field>}
        </>
      )}
      {node.type === "set" && <Field label={t("data.wf.vars")}><KeyValues value={c.vars as Record<string, string>} onChange={(vars) => set({ vars })} placeholder={["name", "{{ steps.request.body.id }}"]} /></Field>}
      {node.type === "delay" && <Field label={t("data.wf.seconds")}><input className="input input-sm" type="number" min={0} max={25} value={Number(c.seconds ?? 0)} onChange={(e) => set({ seconds: Math.max(0, Math.min(25, Number(e.target.value))) })} /></Field>}
      {node.type === "email" && (
        <>
          <Field label={t("data.wf.to")}><input className="input input-sm" value={str("to")} onChange={(e) => set({ to: e.target.value })} placeholder="ops@example.com" /></Field>
          <Field label={t("data.wf.subject")}><input className="input input-sm" value={str("subject")} onChange={(e) => set({ subject: e.target.value })} /></Field>
          <Field label={t("data.wf.text")}><textarea className="textarea small" rows={4} value={str("text")} onChange={(e) => set({ text: e.target.value })} /></Field>
        </>
      )}
      {node.type === "log" && <Field label={t("data.wf.message")}><textarea className="textarea mono small" rows={3} value={str("message")} onChange={(e) => set({ message: e.target.value })} /></Field>}
      {node.type === "transform" && <Field label={t("data.wf.template")}><textarea className="textarea mono small" rows={6} value={str("template")} onChange={(e) => set({ template: e.target.value })} /></Field>}
      {node.type === "condition" ? (<>{link("onTrue", t("data.wf.ifTrue"))}{link("onFalse", t("data.wf.ifFalse"))}</>) : link("next", t("data.wf.then"))}
      <p className="hint">{t("data.wf.refs")}</p>
    </div>
  );
}

function RunList({ runs, onRefresh }: { runs: WfRun[]; onRefresh: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row"><strong className="grow">{t("data.wf.runs")}</strong><button className="icon-btn" aria-label="Refresh" onClick={onRefresh}><I.IconRotate size={13} /></button></div>
      {runs.length === 0 && <div className="hint">{t("data.wf.noRuns")}</div>}
      {runs.map((r) => (
        <div key={r.id} className="card" style={{ padding: 8 }}>
          <div className="row small" style={{ cursor: "pointer", gap: 6 }} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span className={`badge ${r.status === "succeeded" ? "badge-success" : r.status === "failed" ? "badge-danger" : "badge-accent"}`}>{r.status}</span>
            <span className="muted">{r.trigger}</span>
            <span className="grow muted" style={{ textAlign: "right" }}>{new Date(r.started_at).toLocaleString()}</span>
          </div>
          {open === r.id && (
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              {r.error && <div className="small" style={{ color: "var(--mfc-danger)" }}>{r.error}</div>}
              {r.log.map((s, i) => (
                <div key={i} className="col small" style={{ gap: 2, borderLeft: `3px solid ${s.status === "ok" ? "var(--mfc-success)" : "var(--mfc-danger)"}`, paddingLeft: 8 }}>
                  <span><span className="mono">{s.name}</span> <span className="muted">· {s.type} · {s.ms} ms</span></span>
                  {(s.output || s.error) && <code className="mono muted" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{s.error ?? s.output}</code>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Editor({ id, canManage, onChanged, onOpen }: { id: string; canManage: boolean; onChanged: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<WfRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"step" | "runs">("step");
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const loadRuns = useCallback(() => void workflowApi.runs(id).then(setRuns).catch(() => setRuns([])), [id]);
  useEffect(() => {
    workflowApi.get(id).then((r) => setWf(r.workflow)).catch((e: Error) => toast(e.message, "error"));
    loadRuns();
  }, [id, loadRuns]);
  const problems = useMemo(() => (wf ? validateGraph(wf.graph) : []), [wf]);

  const edit = (fn: (w: Workflow) => Workflow) => setWf((w) => (w ? (setDirty(true), fn(w)) : w));
  const setGraph = (fn: (g: WfGraph) => WfGraph) => edit((w) => ({ ...w, graph: fn(w.graph) }));

  const save = async (patch: Partial<Workflow> = {}) => {
    if (!wf) return false;
    const next = { ...wf, ...patch };
    try {
      await workflowApi.save(id, { name: next.name, graph: next.graph, enabled: next.enabled, environment: next.environment });
      const fresh = await workflowApi.get(id);
      setWf(fresh.workflow);
      setDirty(false);
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && dirty) {
        e.preventDefault();
        void save().then((ok): unknown => ok && toast(t("common.saved"), "success"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!wf) return <div className="grow muted" style={{ padding: 20 }}>{t("common.loading")}</div>;
  const node = wf.graph.nodes.find((n) => n.id === selected) ?? null;

  const run = async (withInput = false) => {
    let input: unknown;
    if (withInput) {
      const raw = await ask(t("data.wf.testInput"), '{\n  "hello": "world"\n}', { multiline: true });
      if (raw === null) return;
      try {
        input = raw.trim() ? JSON.parse(raw) : undefined;
      } catch {
        return toast(t("data.wf.badJson"), "error");
      }
    }
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const r = await workflowApi.run(id, input);
      toast(r?.status === "succeeded" ? t("data.wf.runOk") : `${t("data.wf.runFailed")}: ${r?.error ?? ""}`, r?.status === "succeeded" ? "success" : "error");
      loadRuns();
      setSide("runs");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    try {
      const nid = await workflowApi.create(`${wf.name} (copy)`, wf.graph);
      onChanged();
      onOpen(nid);
      toast(t("data.duplicated"), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const addStep = (type: NodeType) => {
    const from = node ?? wf.graph.nodes.find((n) => n.type === "trigger");
    // Place right of the source step, moving down until the spot is free.
    const x = (from?.x ?? 40) + NODE_W + 60;
    let y = from?.y ?? 40;
    while (wf.graph.nodes.some((n) => Math.abs((n.x ?? 0) - x) < NODE_W + 20 && Math.abs((n.y ?? 0) - y) < NODE_H + 20)) y += NODE_H + 40;
    const nn = newNode(type, wf.graph.nodes, x, y);
    setGraph((g) => ({
      nodes: [
        ...g.nodes.map((n) => {
          if (n.id !== from?.id) return n;
          if (n.type === "condition") return n.onTrue ? (n.onFalse ? n : { ...n, onFalse: nn.id }) : { ...n, onTrue: nn.id };
          return { ...n, next: nn.id };
        }),
        // Splice the new step into the chain: it inherits what the source step pointed to.
        nn.type === "condition"
          ? { ...nn, next: null, onTrue: from && from.type !== "condition" ? from.next ?? null : null }
          : { ...nn, next: from && from.type !== "condition" ? from.next ?? null : null },
      ],
    }));
    setSelected(nn.id);
    setSide("step");
  };

  const edges = wf.graph.nodes.flatMap((n) =>
    (n.type === "condition" ? ([["onTrue", "var(--mfc-success)"], ["onFalse", "var(--mfc-danger)"]] as const) : ([["next", "var(--mfc-muted)"]] as const)).flatMap(([k, color]) => {
      const to = n[k] && wf.graph.nodes.find((x) => x.id === n[k]);
      if (!to) return [];
      const x1 = (n.x ?? 0) + NODE_W, y1 = (n.y ?? 0) + NODE_H / 2 + (k === "onTrue" ? -10 : k === "onFalse" ? 10 : 0);
      const x2 = to.x ?? 0, y2 = (to.y ?? 0) + NODE_H / 2;
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      return [{ key: `${n.id}-${k}`, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, color, label: k === "onTrue" ? "yes" : k === "onFalse" ? "no" : "", mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }];
    }),
  );
  const width = Math.max(900, ...wf.graph.nodes.map((n) => (n.x ?? 0) + NODE_W + 80));
  const height = Math.max(420, ...wf.graph.nodes.map((n) => (n.y ?? 0) + NODE_H + 80));

  return (
    <div className="col grow" style={{ minWidth: 0, gap: 0 }}>
      <div className="toolbar">
        <input className="input input-sm" style={{ width: 200 }} value={wf.name} disabled={!canManage} onChange={(e) => edit((w) => ({ ...w, name: e.target.value }))} aria-label={t("common.name")} />
        <select className="select input-sm" style={{ width: 130 }} value={wf.environment} disabled={!canManage} onChange={(e) => edit((w) => ({ ...w, environment: e.target.value as Environment }))} title={t("data.secretEnv")} aria-label={t("data.secretEnv")}>
          {ENVIRONMENTS.map((e) => <option key={e} value={e}>{t(`vault.env.${e}`)}</option>)}
        </select>
        {canManage && (
          <select className="select input-sm" style={{ width: 130 }} value="" onChange={(e) => e.target.value && addStep(e.target.value as NodeType)} aria-label={t("data.wf.addStep")}>
            <option value="">+ {t("data.wf.addStep")}</option>
            {NODE_TYPES.filter((x) => x !== "trigger").map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <div className="grow" />
        {problems.length > 0 ? <span className="badge badge-warning" title={problems.join("\n")}><I.IconWarning size={12} /> {problems.length}</span> : <span className="badge badge-success"><I.IconCheck size={12} /> valid</span>}
        {canManage && (
          <label className="row small" style={{ gap: 6 }} title={problems.length ? problems.join("\n") : ""}>
            <input type="checkbox" checked={wf.enabled} disabled={!wf.enabled && problems.length > 0} onChange={(e) => {
              const on = e.target.checked;
              setWf((w) => (w ? { ...w, enabled: on } : w));
              void save({ enabled: on }).then((ok) => (ok ? toast(on ? t("data.wf.enabled") : t("data.wf.disabled"), "success") : setWf((w) => (w ? { ...w, enabled: !on } : w))));
            }} />
            {t("data.wf.enabledLabel")}
          </label>
        )}
        {canManage && <button className="btn btn-sm" disabled={!dirty} onClick={() => void save().then((ok): unknown => ok && toast(t("common.saved"), "success"))}><I.IconSave size={14} /> {t("common.save")}</button>}
        {canManage && <button className="btn btn-sm" disabled={busy || problems.length > 0} onClick={() => void run(true)} title={t("data.wf.testInput")}>{"{ }"}</button>}
        {canManage && <button className="btn btn-sm btn-ghost" onClick={() => void duplicate()} title={t("data.duplicate")}><I.IconCopy size={14} /></button>}
        {canManage && <button className="btn btn-sm btn-primary" disabled={busy || problems.length > 0} onClick={() => void run()}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconPlay size={14} />} {t("data.wf.runNow")}</button>}
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: "stretch", gap: 0 }}>
        <div
          ref={canvas}
          className="schema-canvas grow"
          onPointerMove={(e) => {
            if (!drag.current || !canvas.current) return;
            const r = canvas.current.getBoundingClientRect();
            const x = Math.max(0, Math.round((e.clientX - r.left + canvas.current.scrollLeft - drag.current.dx) / 10) * 10);
            const y = Math.max(0, Math.round((e.clientY - r.top + canvas.current.scrollTop - drag.current.dy) / 10) * 10);
            const nid = drag.current.id;
            setGraph((g) => ({ nodes: g.nodes.map((n) => (n.id === nid ? { ...n, x, y } : n)) }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
            <defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--mfc-muted)" /></marker></defs>
            {edges.map((e) => (
              <g key={e.key}>
                <path d={e.d} fill="none" stroke={e.color} strokeWidth={2} markerEnd="url(#wf-arrow)" />
                {e.label && <text x={e.mx} y={e.my - 4} fontSize={11} fill={e.color} textAnchor="middle">{e.label}</text>}
              </g>
            ))}
          </svg>
          <div style={{ position: "relative", width, height }}>
            {wf.graph.nodes.map((n) => (
              <div
                key={n.id}
                className={`wf-node ${selected === n.id ? "selected" : ""}`}
                style={{ left: n.x ?? 0, top: n.y ?? 0, width: NODE_W, height: NODE_H, borderLeftColor: TYPE_COLOR[n.type] }}
                onPointerDown={(e) => {
                  if (!canManage) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  drag.current = { id: n.id, dx: e.clientX - r.left, dy: e.clientY - r.top };
                }}
                onClick={() => (setSelected(n.id), setSide("step"))}
                role="button"
                tabIndex={0}
                aria-label={`${n.type} ${n.name}`}
                onKeyDown={(e) => e.key === "Enter" && (setSelected(n.id), setSide("step"))}
              >
                <div className="row small" style={{ gap: 6 }}>
                  <span style={{ color: TYPE_COLOR[n.type], fontWeight: 600 }}>{n.type}</span>
                  <span className="mono ellipsis grow">{n.name}</span>
                </div>
                <div className="small muted ellipsis mono">{summary(n)}</div>
              </div>
            ))}
          </div>
        </div>
        <aside className="panel" style={{ width: 340, borderLeft: "1px solid var(--mfc-border)" }}>
          <div className="tabs">
            <button className={`tab ${side === "step" ? "active" : ""}`} onClick={() => setSide("step")}>{t("data.wf.step")}</button>
            <button className={`tab ${side === "runs" ? "active" : ""}`} onClick={() => (setSide("runs"), loadRuns())}>{t("data.wf.runs")} {runs.length ? `(${runs.length})` : ""}</button>
          </div>
          <div className="panel-body" style={{ padding: 12 }}>
            {side === "runs" ? <RunList runs={runs} onRefresh={loadRuns} /> : node ? (
              <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0 }}>
                <Inspector
                  node={node}
                  graph={wf.graph}
                  wf={wf}
                  onChange={(nn) => setGraph((g) => ({ nodes: g.nodes.map((x) => (x.id === nn.id ? nn : x)) }))}
                  onRemove={() => (setGraph((g) => removeNode(g, node.id)), setSelected(null))}
                  onRotate={() => void confirmDialog(t("data.wf.rotateConfirm"), { danger: true }).then((ok): unknown => ok && workflowApi.rotateWebhook(id).then((webhookPath) => (setWf((w) => (w ? { ...w, webhookPath } : w)), toast(t("data.wf.rotated"), "success"))))}
                />
              </fieldset>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <p className="hint">{t("data.wf.pickStep")}</p>
                {problems.map((p) => <div key={p} className="badge badge-warning" style={{ whiteSpace: "normal" }}>{p}</div>)}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function Workflows() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const canManage = can(role, "workflows.manage");
  const [params, setParams] = useSearchParams();
  const active = params.get("workflow");
  const [list, setList] = useState<Workflow[]>([]);
  const reload = useCallback(() => void workflowApi.list().then(setList).catch(() => setList([])), []);
  useEffect(reload, [reload]);
  const open = (id: string | null) => setParams(id ? { tab: "workflows", workflow: id } : { tab: "workflows" });

  const create = async () => {
    const name = (await ask(t("data.wf.name"), "New workflow"))?.trim();
    if (!name) return;
    try {
      const id = await workflowApi.create(name);
      reload();
      open(id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="data-split">
      <aside className="panel data-side">
        <div className="panel-header">
          <span className="grow">{t("data.tab.workflows")}</span>
          {canManage && <button className="icon-btn" title={t("common.new")} onClick={() => void create()}><I.IconPlus size={15} /></button>}
        </div>
        <div className="panel-body" style={{ padding: 6 }}>
          {list.length === 0 && <div className="hint" style={{ padding: 8 }}>{t("data.wf.none")}</div>}
          {list.map((w) => (
            <div key={w.id} className={`list-item ${active === w.id ? "selected" : ""}`} onClick={() => open(w.id)}>
              <span className={`status-dot ${w.enabled ? "on" : ""}`} title={w.enabled ? t("data.wf.enabled") : t("data.wf.disabled")} />
              <span className="grow ellipsis">{w.name}</span>
              <span className="badge">{w.trigger}</span>
              {w.lastRun && <span className={`badge ${w.lastRun.status === "succeeded" ? "badge-success" : "badge-danger"}`} title={new Date(w.lastRun.started_at).toLocaleString()}>{w.lastRun.status === "succeeded" ? "✓" : "✕"}</span>}
              {canManage && <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={t("common.delete")} onClick={(e) => { e.stopPropagation(); void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && workflowApi.remove(w.id).then(() => (active === w.id && open(null), reload()))); }}><I.IconTrash size={12} /></button>}
            </div>
          ))}
        </div>
      </aside>
      {active ? <Editor key={active} id={active} canManage={canManage} onChanged={reload} onOpen={open} /> : <div className="grow" style={{ padding: 16 }}><div className="empty">{t("data.wf.intro")}</div></div>}
    </div>
  );
}
