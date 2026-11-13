import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useStudio } from "./store";
import { Viewport } from "./Viewport";
import { Outliner } from "./Outliner";
import { Properties } from "./Properties";
import { Timeline } from "./Timeline";
import { LIGHT_TYPES, PRIMITIVES, SHAPES } from "./model";
import { SCENE_PRESETS } from "./presets";
import { projectsApi, type ProjectSummary } from "../../lib/projects";
import { NewProjectModal } from "../home/HomePage";
import { runFunction } from "../../lib/registry";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

const run = (id: string) => runFunction(id).catch((e: Error) => toast(e.message, "error"));

function Toolbar() {
  const t = useT();
  const s = useStudio();
  const saveLabel = s.saveState === "saving" ? t("common.saving") : s.saveState === "saved" ? t("common.saved") : s.saveState === "error" ? t("common.error") : s.saveState === "dirty" ? "•" : "";
  return (
    <div className="toolbar">
      <strong className="ellipsis" style={{ maxWidth: 200, padding: "0 6px" }}>{s.projectName}</strong>
      <span className="small muted" style={{ minWidth: 56 }}>{saveLabel}</span>
      <div className="toolbar-sep" />
      <select className="select input-sm" style={{ width: 130 }} value="" aria-label={t("studio.add")} onChange={(e) => e.target.value && run(e.target.value)}>
        <option value="">+ {t("studio.add")}…</option>
        <optgroup label="Primitives">{PRIMITIVES.map((p) => <option key={p} value={`studio.add.${p}`}>{p}</option>)}</optgroup>
        <optgroup label="Extruded shapes">{SHAPES.map((p) => <option key={p} value={`studio.add.shape-${p}`}>{p}</option>)}</optgroup>
        <optgroup label="Lights">{LIGHT_TYPES.map((p) => <option key={p} value={`studio.add.light-${p}`}>{p} light</option>)}</optgroup>
        <optgroup label="Other"><option value="studio.add.camera">camera</option><option value="studio.add.group">group</option><option value="studio.import">Import model…</option></optgroup>
      </select>
      <div className="toolbar-sep" />
      <button className="icon-btn" title="Undo" disabled={!s.past.length} onClick={s.undo}><I.IconUndo size={16} /></button>
      <button className="icon-btn" title="Redo" disabled={!s.future.length} onClick={s.redo}><I.IconRedo size={16} /></button>
      <div className="toolbar-sep" />
      <button className={`icon-btn ${s.gizmo === "translate" ? "active" : ""}`} title="Move (W)" onClick={() => s.setGizmo("translate")}><I.IconMove size={16} /></button>
      <button className={`icon-btn ${s.gizmo === "rotate" ? "active" : ""}`} title="Rotate (E)" onClick={() => s.setGizmo("rotate")}><I.IconRotate3d size={16} /></button>
      <button className={`icon-btn ${s.gizmo === "scale" ? "active" : ""}`} title="Scale (R)" onClick={() => s.setGizmo("scale")}><I.IconScale3d size={16} /></button>
      <button className={`btn btn-sm ${s.space === "local" ? "btn-primary" : ""}`} onClick={s.toggleSpace} title="Gizmo space">{s.space}</button>
      <button className={`btn btn-sm ${s.snap ? "btn-primary" : ""}`} onClick={s.toggleSnap} title="Snap">snap</button>
      <div className="toolbar-sep" />
      <button className="btn btn-sm btn-ghost" onClick={() => run("studio.view.front")}>Front</button>
      <button className="btn btn-sm btn-ghost" onClick={() => run("studio.view.top")}>Top</button>
      <button className="btn btn-sm btn-ghost" onClick={() => run("studio.view.right")}>Right</button>
      <button className="btn btn-sm btn-ghost" onClick={() => run("studio.view.perspective")}>Persp</button>
      <button className="icon-btn" title="Frame selection (F)" onClick={() => run("studio.view.frame")}><I.IconMaximize size={15} /></button>
      <div className="grow" />
      <select className="select input-sm" style={{ width: 150 }} value="" onChange={(e) => e.target.value && run(e.target.value)}>
        <option value="">Scene presets…</option>
        {SCENE_PRESETS.map((p) => <option key={p.id} value={`studio.preset.${p.id}`}>{p.name}</option>)}
      </select>
      <select className="select input-sm" style={{ width: 120 }} value="" onChange={(e) => e.target.value && run(e.target.value)}>
        <option value="">{t("common.export")}…</option>
        <option value="studio.export.glb">GLB</option>
        <option value="studio.export.gltf">GLTF</option>
        <option value="studio.export.obj">OBJ</option>
        <option value="studio.export.stl">STL</option>
        <option value="studio.export.png">PNG snapshot</option>
        <option value="studio.export.json">Scene JSON</option>
      </select>
    </div>
  );
}

function ProjectPicker() {
  const t = useT();
  const [, setParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    projectsApi.list("scene3d").then(setProjects).catch(() => setProjects([]));
  }, []);
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t("nav.studio")}</h1>
            <p className="page-subtitle">{t("studio.openProject")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><I.IconPlus size={16} /> {t("home.newProject")}</button>
        </div>
        {projects === null ? <div className="muted">{t("common.loading")}</div> : projects.length === 0 ? <div className="empty">{t("home.empty")}</div> : (
          <div className="grid-auto">
            {projects.map((p) => (
              <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setParams({ project: p.id })}>
                <div className="card-title">{p.name}</div>
                <div className="small muted">{t("home.kind.scene3d")}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {showNew && <NewProjectModal defaultKind="scene3d" onClose={() => setShowNew(false)} />}
    </div>
  );
}

export default function StudioPage() {
  const t = useT();
  const [params] = useSearchParams();
  const projectParam = params.get("project");
  const projectId = useStudio((s) => s.projectId);
  const loading = useStudio((s) => s.loading);

  useEffect(() => {
    if (projectParam && projectParam !== useStudio.getState().projectId) useStudio.getState().open(projectParam).catch((e: Error) => toast(e.message, "error"));
  }, [projectParam]);
  useEffect(() => () => useStudio.getState().setPlaying(false), []);

  if (!projectParam) return <ProjectPicker />;
  if (loading || projectId !== projectParam) return <div className="page muted">{t("common.loading")}</div>;

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <Toolbar />
      <PanelGroup direction="horizontal" autoSaveId="mfc.studio.h" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={16} minSize={12} maxSize={30}>
          <div className="panel" style={{ borderRight: "1px solid var(--mfc-border)" }}>
            <div className="panel-header">{t("studio.outliner")}</div>
            <div className="panel-body"><Outliner /></div>
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="mfc.studio.v">
            <Panel minSize={30}>
              <div style={{ position: "relative", height: "100%" }}><Viewport /></div>
            </Panel>
            <PanelResizeHandle className="resize-handle resize-handle-h" />
            <Panel defaultSize={26} minSize={12}>
              <Timeline />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={22} minSize={16} maxSize={36}>
          <div className="panel" style={{ borderLeft: "1px solid var(--mfc-border)" }}>
            <div className="panel-header">{t("studio.properties")}</div>
            <div className="panel-body"><Properties /></div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
