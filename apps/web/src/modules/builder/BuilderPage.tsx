import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useBuilder, type Device } from "./store";
import { CATALOG, CATEGORIES, CATALOG_MAP, defFor } from "./catalog";
import { Canvas, DRAG_MIME, MOVE_MIME } from "./Canvas";
import { Inspector } from "./Inspector";
import { TEMPLATES } from "./templates";
import type { BNode, SiteTokens } from "./model";
import { projectsApi, type ProjectSummary } from "../../lib/projects";
import { NewProjectModal } from "../home/HomePage";
import { runFunction } from "../../lib/registry";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

const CodePanel = lazy(() => import("./CodePanel"));

function ComponentsPalette() {
  const [q, setQ] = useState("");
  const items = CATALOG.filter((c) => c.type !== "page" && (`${c.label} ${c.type} ${c.description} ${c.category}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div style={{ padding: 10 }}>
      <input className="input input-sm" placeholder="Filter components…" value={q} onChange={(e) => setQ(e.target.value)} />
      {CATEGORIES.map((cat) => {
        const list = items.filter((c) => c.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat}>
            <div className="section-label">{cat}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {list.map((c) => (
                <button
                  key={c.type}
                  className="btn btn-sm"
                  style={{ justifyContent: "flex-start", height: 32, cursor: "grab" }}
                  draggable
                  title={`${c.description} — drag onto the canvas or click to insert`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, c.type);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    try {
                      useBuilder.getState().insert(c.type);
                    } catch (err) {
                      toast((err as Error).message, "error");
                    }
                  }}
                >
                  <span className="ellipsis">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LayerRow({ node, depth }: { node: BNode; depth: number }) {
  const selected = useBuilder((s) => s.selectedId === node.id);
  const [open, setOpen] = useState(true);
  const def = defFor(node.type);
  const label = String(node.props.text ?? node.props.title ?? node.props.brand ?? node.props.label ?? "").slice(0, 28);
  return (
    <>
      <div
        className={`list-item ${selected ? "selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={node.type !== "page"}
        onDragStart={(e) => {
          e.dataTransfer.setData(MOVE_MIME, node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MOVE_MIME) || e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const st = useBuilder.getState();
          const moveId = e.dataTransfer.getData(MOVE_MIME);
          const type = e.dataTransfer.getData(DRAG_MIME);
          try {
            if (def.container) {
              if (moveId) st.moveTo(moveId, node.id, node.children.length);
              else if (type) st.insert(type, { parentId: node.id });
            } else {
              const root = st.page().root;
              const stack: Array<[BNode, BNode | null]> = [[root, null]];
              let parent: BNode | null = null;
              while (stack.length) {
                const [cur] = stack.pop()!;
                if (cur.children.some((c) => c.id === node.id)) {
                  parent = cur;
                  break;
                }
                cur.children.forEach((c) => stack.push([c, cur]));
              }
              if (!parent) return;
              const idx = parent.children.findIndex((c) => c.id === node.id) + 1;
              if (moveId) st.moveTo(moveId, parent.id, idx);
              else if (type) st.insert(type, { parentId: parent.id, index: idx });
            }
          } catch (err) {
            toast((err as Error).message, "error");
          }
        }}
        onClick={() => useBuilder.getState().select(node.id)}
      >
        {node.children.length > 0 ? (
          <button className="icon-btn" style={{ width: 16, height: 16 }} onClick={(e) => (e.stopPropagation(), setOpen(!open))} aria-label={open ? "Collapse" : "Expand"}>
            {open ? <I.IconChevronDown size={12} /> : <I.IconChevronRight size={12} />}
          </button>
        ) : (
          <span style={{ width: 16 }} />
        )}
        <span className="ellipsis grow">
          {def.label}
          {label && <span className="muted"> · {label}</span>}
        </span>
      </div>
      {open && node.children.map((c) => <LayerRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

function PagesAndTokens() {
  const t = useT();
  const doc = useBuilder((s) => s.doc);
  const pageId = useBuilder((s) => s.page().id);
  const st = useBuilder.getState();
  const tokenFields: Array<[keyof SiteTokens, string, "color" | "text"]> = [
    ["primary", "Primary", "color"],
    ["primaryText", "On primary", "color"],
    ["bg", "Background", "color"],
    ["surface", "Surface", "color"],
    ["text", "Text", "color"],
    ["muted", "Muted text", "color"],
    ["border", "Border", "color"],
    ["radius", "Radius", "text"],
    ["maxWidth", "Max width", "text"],
    ["font", "Body font", "text"],
    ["headingFont", "Heading font", "text"],
  ];
  return (
    <div style={{ padding: 10 }}>
      <div className="row">
        <div className="section-label grow">{t("builder.pages")}</div>
        <button className="icon-btn" title="Add page" onClick={() => st.addPage(window.prompt("Page name", "New page") ?? "New page")}>
          <I.IconPlus size={15} />
        </button>
      </div>
      {doc.pages.map((p) => (
        <div key={p.id} className={`list-item ${p.id === pageId ? "selected" : ""}`} onClick={() => st.setPage(p.id)}>
          <span className="grow ellipsis">{p.name}</span>
          <span className="small muted">{p.path}</span>
          {doc.pages.length > 1 && (
            <button className="icon-btn" style={{ width: 22, height: 22 }} title="Delete page" onClick={(e) => (e.stopPropagation(), window.confirm(t("common.confirm")) && st.removePage(p.id))}>
              <I.IconTrash size={13} />
            </button>
          )}
        </div>
      ))}
      <div className="section-label">{t("builder.tokens")}</div>
      <div className="prop-grid">
        {tokenFields.map(([k, label, kind]) => (
          <div key={k} style={{ display: "contents" }}>
            <label>{label}</label>
            {kind === "color" ? (
              <div className="row" style={{ gap: 6 }}>
                <input className="color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(doc.tokens[k]) ? doc.tokens[k] : "#000000"} onChange={(e) => st.setTokens({ [k]: e.target.value })} />
                <input className="input input-sm" value={doc.tokens[k]} onChange={(e) => st.setTokens({ [k]: e.target.value })} />
              </div>
            ) : (
              <input className="input input-sm" value={doc.tokens[k]} onChange={(e) => st.setTokens({ [k]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Toolbar() {
  const t = useT();
  const s = useBuilder();
  const devices: Array<[Device, typeof I.IconDesktop]> = [
    ["desktop", I.IconDesktop],
    ["tablet", I.IconTablet],
    ["mobile", I.IconPhone],
  ];
  const saveLabel = s.saveState === "saving" ? t("common.saving") : s.saveState === "saved" ? t("common.saved") : s.saveState === "error" ? t("common.error") : s.saveState === "dirty" ? "•" : "";
  return (
    <div className="toolbar">
      <strong className="ellipsis" style={{ maxWidth: 220, padding: "0 6px" }}>{s.projectName}</strong>
      <span className="small muted" style={{ minWidth: 60 }}>{saveLabel}</span>
      <div className="toolbar-sep" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><I.IconUndo size={16} /></button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!s.future.length} onClick={s.redo}><I.IconRedo size={16} /></button>
      <div className="toolbar-sep" />
      {devices.map(([d, Icon]) => (
        <button key={d} className={`icon-btn ${s.device === d ? "active" : ""}`} title={d} onClick={() => s.setDevice(d)}>
          <Icon size={16} />
        </button>
      ))}
      <div className="toolbar-sep" />
      <button className="btn btn-sm btn-ghost" onClick={() => s.setZoom(s.zoom - 0.1)}>−</button>
      <span className="small" style={{ width: 40, textAlign: "center" }}>{Math.round(s.zoom * 100)}%</span>
      <button className="btn btn-sm btn-ghost" onClick={() => s.setZoom(s.zoom + 0.1)}>+</button>
      <button className={`icon-btn ${s.outlines ? "active" : ""}`} title="Toggle outlines" onClick={s.toggleOutlines}><I.IconGrid size={16} /></button>
      <div className="grow" />
      <select className="select input-sm" style={{ width: 190 }} value="" onChange={(e) => e.target.value && runFunction(`builder.template.${e.target.value}`).catch((err: Error) => toast(err.message, "error"))}>
        <option value="">Insert template…</option>
        {TEMPLATES.map((tp) => (
          <option key={tp.id} value={tp.id}>
            {tp.name}
          </option>
        ))}
      </select>
      <button className={`btn btn-sm ${s.codeOpen ? "btn-primary" : ""}`} onClick={() => s.setCodeOpen(!s.codeOpen)}>
        <I.IconCode size={14} /> {t("builder.code")}
      </button>
      <button className="btn btn-sm" onClick={() => runFunction("builder.export.html")}>
        <I.IconDownload size={14} /> HTML
      </button>
      <button className="btn btn-sm" onClick={() => runFunction("builder.export.react")}>
        <I.IconDownload size={14} /> React
      </button>
    </div>
  );
}

function ProjectPicker() {
  const t = useT();
  const [, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    projectsApi.list().then((p) => setProjects(p.filter((x) => x.kind !== "scene3d"))).catch(() => setProjects([]));
  }, []);
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t("nav.builder")}</h1>
            <p className="page-subtitle">{t("builder.openProject")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <I.IconPlus size={16} /> {t("home.newProject")}
          </button>
        </div>
        {projects === null ? (
          <div className="muted">{t("common.loading")}</div>
        ) : projects.length === 0 ? (
          <div className="empty">{t("home.empty")}</div>
        ) : (
          <div className="grid-auto">
            {projects.map((p) => (
              <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setParams({ project: p.id })}>
                <div className="card-title">{p.name}</div>
                <div className="small muted">{t(`home.kind.${p.kind}`)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

export default function BuilderPage() {
  const t = useT();
  const [params] = useSearchParams();
  const projectParam = params.get("project");
  const projectId = useBuilder((s) => s.projectId);
  const loading = useBuilder((s) => s.loading);
  const codeOpen = useBuilder((s) => s.codeOpen);
  const root = useBuilder((s) => s.page().root);
  const [leftTab, setLeftTab] = useState<"components" | "layers" | "pages">("components");

  useEffect(() => {
    if (projectParam && projectParam !== useBuilder.getState().projectId) {
      useBuilder.getState().open(projectParam).catch((e: Error) => toast(e.message, "error"));
    }
  }, [projectParam]);

  const layerCount = useMemo(() => {
    let n = 0;
    const walk = (x: BNode) => {
      n++;
      x.children.forEach(walk);
    };
    walk(root);
    return n - 1;
  }, [root]);

  if (!projectParam) return <ProjectPicker />;
  if (loading || projectId !== projectParam) return <div className="page muted">{t("common.loading")}</div>;

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <Toolbar />
      <PanelGroup direction="horizontal" autoSaveId="mfc.builder.h" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={20} minSize={14} maxSize={35}>
          <div className="panel" style={{ borderRight: "1px solid var(--mfc-border)" }}>
            <div className="tabs">
              <button className={`tab ${leftTab === "components" ? "active" : ""}`} onClick={() => setLeftTab("components")}>{t("builder.components")}</button>
              <button className={`tab ${leftTab === "layers" ? "active" : ""}`} onClick={() => setLeftTab("layers")}>{t("builder.layers")} ({layerCount})</button>
              <button className={`tab ${leftTab === "pages" ? "active" : ""}`} onClick={() => setLeftTab("pages")}>{t("builder.pages")}</button>
            </div>
            <div className="panel-body">
              {leftTab === "components" && <ComponentsPalette />}
              {leftTab === "layers" && (
                <div style={{ padding: 6 }}>
                  <LayerRow node={root} depth={0} />
                </div>
              )}
              {leftTab === "pages" && <PagesAndTokens />}
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="mfc.builder.v">
            <Panel minSize={25}>
              <Canvas />
            </Panel>
            {codeOpen && (
              <>
                <PanelResizeHandle className="resize-handle resize-handle-h" />
                <Panel defaultSize={40} minSize={15}>
                  <Suspense fallback={<div className="page muted">{t("common.loading")}</div>}>
                    <CodePanel />
                  </Suspense>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={22} minSize={16} maxSize={40}>
          <div className="panel" style={{ borderLeft: "1px solid var(--mfc-border)" }}>
            <div className="panel-header">{t("builder.inspector")}</div>
            <div className="panel-body">
              <Inspector />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export { CATALOG_MAP };
