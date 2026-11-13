import { useMemo } from "react";
import { useBuilder, useBuilderUi } from "./store";
import { auditPage } from "./a11y";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

export function A11yPanel() {
  const t = useT();
  const open = useBuilderUi((s) => s.a11yOpen);
  const page = useBuilder((s) => s.page());
  const tokens = useBuilder((s) => s.doc.tokens);
  const report = useMemo(() => (open ? auditPage(page, tokens) : null), [open, page, tokens]);
  if (!open || !report) return null;
  const close = () => useBuilderUi.getState().set({ a11yOpen: false });
  const tone = report.score >= 90 ? "badge-success" : report.score >= 70 ? "badge-warning" : "badge-danger";
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("builder.a11yTitle")} style={{ width: "min(680px, calc(100vw - 32px))" }}>
        <div className="row">
          <I.IconShield size={18} />
          <div className="modal-title grow">{t("builder.a11yTitle")}</div>
          <span className={`badge ${tone}`}>{report.score}/100</span>
          <button className="icon-btn" onClick={close} aria-label={t("common.close")}><I.IconClose size={16} /></button>
        </div>
        <p className="hint" style={{ margin: "6px 0 12px" }}>{t("builder.a11yHint")}</p>
        {report.issues.length === 0 ? (
          <div className="badge badge-success" style={{ padding: "8px 12px" }}><I.IconCheck size={14} /> {t("builder.a11yClean")}</div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {report.issues.map((i, k) => (
              <div key={k} className="card row" style={{ padding: "8px 12px" }}>
                <span className={`badge ${i.severity === "error" ? "badge-danger" : "badge-warning"}`}>{i.severity}</span>
                <span className="grow small">{i.message}</span>
                {i.nodeId && (
                  <button className="btn btn-sm" onClick={() => (useBuilder.getState().select(i.nodeId!), close())}>
                    <I.IconPointer size={13} /> {t("builder.select")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PageSettings() {
  const t = useT();
  const id = useBuilderUi((s) => s.pageSettingsId);
  const page = useBuilder((s) => s.doc.pages.find((p) => p.id === id));
  if (!id || !page) return null;
  const close = () => useBuilderUi.getState().set({ pageSettingsId: null });
  const up = (patch: Parameters<ReturnType<typeof useBuilder.getState>["updatePage"]>[1]) => useBuilder.getState().updatePage(page.id, patch);
  const desc = page.description ?? "";
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("builder.pageSettings")}>
        <div className="row">
          <div className="modal-title grow">{t("builder.pageSettings")}</div>
          <button className="icon-btn" onClick={close} aria-label={t("common.close")}><I.IconClose size={16} /></button>
        </div>
        <div className="col" style={{ gap: 12, marginTop: 12 }}>
          <div className="row wrap">
            <div className="field grow"><label>{t("common.name")}</label><input className="input" value={page.name} onChange={(e) => up({ name: e.target.value })} /></div>
            <div className="field grow"><label>{t("builder.path")}</label><input className="input mono" value={page.path} onChange={(e) => up({ path: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t("builder.seoTitle")}</label><input className="input" value={page.title} maxLength={70} onChange={(e) => up({ title: e.target.value })} /><span className="hint">{page.title.length}/60</span></div>
          <div className="field"><label>{t("builder.seoDescription")}</label><textarea className="textarea" rows={3} maxLength={200} value={desc} onChange={(e) => up({ description: e.target.value })} /><span className="hint" style={{ color: desc.length > 160 ? "var(--mfc-warning)" : undefined }}>{desc.length}/160</span></div>
          <div className="row wrap">
            <div className="field grow"><label>{t("builder.ogImage")}</label><input className="input" placeholder="https://…/share.png" value={page.ogImage ?? ""} onChange={(e) => up({ ogImage: e.target.value })} /></div>
            <div className="field" style={{ width: 120 }}><label>{t("settings.language")}</label><input className="input" value={page.lang ?? "en"} maxLength={10} onChange={(e) => up({ lang: e.target.value })} /></div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="small muted">{t("builder.searchPreview")}</div>
            <div style={{ color: "#8ab4f8", fontSize: 17, marginTop: 4 }} className="ellipsis">{page.title || page.name}</div>
            <div className="small" style={{ color: "var(--mfc-success)" }}>example.com{page.path}</div>
            <div className="small muted">{desc || "—"}</div>
          </div>
        </div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={close}>{t("common.done")}</button></div>
      </div>
    </div>
  );
}
