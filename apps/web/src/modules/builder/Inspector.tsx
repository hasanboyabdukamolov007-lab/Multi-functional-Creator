import { useBuilder } from "./store";
import { CATALOG_MAP, defFor, type PropField } from "./catalog";
import { pathTo } from "./model";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

const STYLE_FIELDS: Array<{ key: string; label: string; placeholder?: string; options?: string[] }> = [
  { key: "width", label: "Width", placeholder: "auto, 100%, 320px" },
  { key: "maxWidth", label: "Max width" },
  { key: "minHeight", label: "Min height" },
  { key: "padding", label: "Padding", placeholder: "16px 24px" },
  { key: "margin", label: "Margin" },
  { key: "gap", label: "Gap" },
  { key: "display", label: "Display", options: ["", "block", "flex", "grid", "inline-flex", "none"] },
  { key: "flexDirection", label: "Direction", options: ["", "row", "column", "row-reverse", "column-reverse"] },
  { key: "justifyContent", label: "Justify", options: ["", "flex-start", "center", "flex-end", "space-between", "space-around"] },
  { key: "alignItems", label: "Align", options: ["", "flex-start", "center", "flex-end", "stretch"] },
  { key: "textAlign", label: "Text align", options: ["", "left", "center", "right", "justify"] },
  { key: "fontSize", label: "Font size" },
  { key: "fontWeight", label: "Weight", options: ["", "300", "400", "500", "600", "700", "800"] },
  { key: "color", label: "Text color" },
  { key: "background", label: "Background" },
  { key: "border", label: "Border", placeholder: "1px solid var(--color-border)" },
  { key: "borderRadius", label: "Radius" },
  { key: "boxShadow", label: "Shadow" },
  { key: "opacity", label: "Opacity" },
];

function PropInput({ field, value, onChange }: { field: PropField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.kind) {
    case "textarea":
    case "lines":
    case "code":
      return <textarea className={`textarea ${field.kind === "code" ? "mono" : ""}`} rows={field.kind === "lines" ? 4 : 3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.hint} spellCheck={field.kind !== "code"} />;
    case "number":
      return <input className="input input-sm" type="number" value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
    case "boolean":
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ justifySelf: "start", width: 18, height: 18 }} />;
    case "select":
      return (
        <select className="select input-sm" value={String(value ?? "")} onChange={(e) => onChange(/^\d+$/.test(e.target.value) && field.key === "level" ? Number(e.target.value) : e.target.value)}>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "color":
      return <input className="color-input" type="color" value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className="input input-sm" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.hint} />;
  }
}

export function Inspector() {
  const t = useT();
  const node = useBuilder((s) => s.selected());
  const root = useBuilder((s) => s.page().root);
  const st = useBuilder.getState();
  if (!node) return <div className="hint" style={{ padding: 16 }}>{t("builder.noSelection")}</div>;
  const def = defFor(node.type);
  const props = { ...def.defaults, ...node.props };
  const crumbs = pathTo(root, node.id);

  return (
    <div style={{ padding: 12 }}>
      <div className="row wrap small" style={{ gap: 4, marginBottom: 8 }}>
        {crumbs.map((c, i) => (
          <span key={c.id} className="row" style={{ gap: 4 }}>
            {i > 0 && <I.IconChevronRight size={12} className="muted" />}
            <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px" }} onClick={() => st.select(c.id)}>
              {CATALOG_MAP.get(c.type)?.label ?? c.type}
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <strong className="grow">{def.label}</strong>
        <button className="icon-btn" title="Move up" onClick={() => st.move(node.id, -1)} disabled={node.type === "page"}><I.IconArrowUp size={15} /></button>
        <button className="icon-btn" title="Move down" onClick={() => st.move(node.id, 1)} disabled={node.type === "page"}><I.IconArrowDown size={15} /></button>
        <button className="icon-btn" title="Duplicate" onClick={() => st.duplicate(node.id)} disabled={node.type === "page"}><I.IconCopy size={15} /></button>
        <button className="icon-btn" title="Delete" onClick={() => st.remove(node.id)} disabled={node.type === "page"}><I.IconTrash size={15} /></button>
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>{def.description}</div>

      {def.fields.length > 0 && (
        <>
          <div className="section-label">{t("builder.props")}</div>
          <div className="col" style={{ gap: 10 }}>
            {def.fields.map((f) => (
              <div key={f.key} className="field">
                <label>{f.label}</label>
                <PropInput field={f} value={props[f.key]} onChange={(v) => st.update(node.id, { props: { [f.key]: v } })} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">{t("builder.style")}</div>
      <div className="prop-grid">
        {STYLE_FIELDS.map((f) => (
          <div key={f.key} style={{ display: "contents" }}>
            <label>{f.label}</label>
            {f.options ? (
              <select className="select input-sm" value={node.style[f.key] ?? ""} onChange={(e) => st.update(node.id, { style: { [f.key]: e.target.value || null } })}>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o || "—"}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input input-sm" value={node.style[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => st.update(node.id, { style: { [f.key]: e.target.value || null } })} />
            )}
          </div>
        ))}
      </div>
      {Object.keys(node.style).length > 0 && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => st.update(node.id, { style: Object.fromEntries(Object.keys(node.style).map((k) => [k, null])) })}>
          <I.IconRotate size={13} /> Clear styles
        </button>
      )}
    </div>
  );
}
