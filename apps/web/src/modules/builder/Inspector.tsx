import { useBuilder } from "./store";
import { CATALOG_MAP, defFor, type PropField } from "./catalog";
import { pathTo } from "./model";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";
import { MOTION_PRESETS } from "./motion";

type Opt = [value: string, label: string];
type StyleField = { key: string; label: string; kind: "preset" | "color" | "range"; options?: Opt[] };
const px = (vals: number[], unit = "px"): Opt[] => vals.map((v) => [`${v}${unit}`, `${v}${unit}`]);
const COLORS = ["var(--color-primary)", "#ffffff", "#f3f4f6", "#111827", "#6b7280", "#ef4444", "#f97316", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899"];
const GRADIENTS = ["linear-gradient(135deg, #6d5efc, #c64fd8)", "linear-gradient(135deg, #f97316, #ec4899)", "linear-gradient(135deg, #06b6d4, #3b82f6)", "linear-gradient(135deg, #10b981, #84cc16)", "linear-gradient(180deg, #111827, #374151)"];
/** Every style is picked, never typed: presets, swatches and sliders. Values apply to the canvas instantly. */
const STYLE_FIELDS: StyleField[] = [
  { key: "color", label: "Text color", kind: "color" },
  { key: "background", label: "Background", kind: "color" },
  { key: "fontSize", label: "Font size", kind: "preset", options: px([12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]) },
  { key: "fontWeight", label: "Weight", kind: "preset", options: [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]] },
  { key: "textAlign", label: "Text align", kind: "preset", options: [["left", "Left"], ["center", "Center"], ["right", "Right"]] },
  { key: "borderRadius", label: "Corners", kind: "preset", options: [["0", "Square"], ["6px", "Slight"], ["12px", "Rounded"], ["20px", "Very rounded"], ["999px", "Pill / circle"]] },
  { key: "boxShadow", label: "Shadow", kind: "preset", options: [["none", "None"], ["0 1px 3px rgba(0,0,0,.12)", "Small"], ["0 6px 18px rgba(0,0,0,.14)", "Medium"], ["0 16px 40px rgba(0,0,0,.2)", "Large"], ["0 0 0 4px rgba(109,94,252,.25)", "Glow ring"], ["0 10px 30px rgba(109,94,252,.45)", "Colored glow"]] },
  { key: "border", label: "Border", kind: "preset", options: [["none", "None"], ["1px solid var(--color-border)", "Thin"], ["2px solid var(--color-primary)", "Accent"], ["2px dashed var(--color-border)", "Dashed"]] },
  { key: "opacity", label: "Opacity", kind: "range" },
  { key: "padding", label: "Padding", kind: "preset", options: [["0", "None"], ["6px 12px", "XS"], ["10px 18px", "S"], ["16px 24px", "M"], ["24px 32px", "L"], ["48px 24px", "XL"]] },
  { key: "margin", label: "Margin", kind: "preset", options: [["0", "None"], ["8px 0", "S"], ["16px 0", "M"], ["32px 0", "L"], ["0 auto", "Center block"]] },
  { key: "width", label: "Width", kind: "preset", options: [["auto", "Auto"], ["fit-content", "Fit content"], ["100%", "Full"], ["75%", "3/4"], ["50%", "Half"], ...px([240, 320, 480])] },
  { key: "maxWidth", label: "Max width", kind: "preset", options: [["none", "None"], ...px([480, 640, 800, 1100]), ["100%", "Full"]] },
  { key: "minHeight", label: "Min height", kind: "preset", options: [["auto", "Auto"], ...px([120, 240, 360]), ["50vh", "Half screen"], ["100vh", "Full screen"]] },
  { key: "gap", label: "Gap", kind: "preset", options: px([0, 4, 8, 12, 16, 24, 32]) },
  { key: "display", label: "Display", kind: "preset", options: [["block", "Block"], ["flex", "Row/column (flex)"], ["grid", "Grid"], ["inline-flex", "Inline"], ["none", "Hidden"]] },
  { key: "flexDirection", label: "Direction", kind: "preset", options: [["row", "Row →"], ["column", "Column ↓"]] },
  { key: "justifyContent", label: "Justify", kind: "preset", options: [["flex-start", "Start"], ["center", "Center"], ["flex-end", "End"], ["space-between", "Space between"]] },
  { key: "alignItems", label: "Align", kind: "preset", options: [["flex-start", "Start"], ["center", "Center"], ["flex-end", "End"], ["stretch", "Stretch"]] },
];

/** A colour swatch row: theme colour, palette, gradients (backgrounds), a full picker, and clear. */
function ColorPick({ value, gradients, onPick }: { value: string; gradients: boolean; onPick: (v: string | null, live?: boolean) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6d5efc";
  return (
    <div className="swatches">
      {[...COLORS, ...(gradients ? GRADIENTS : [])].map((c) => (
        <button key={c} type="button" className={`swatch ${value === c ? "on" : ""}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
      ))}
      <label className="swatch swatch-picker" title="Any colour">
        <input type="color" value={hex} onChange={(e) => onPick(e.target.value, true)} aria-label="Pick any colour" />
      </label>
      {value && <button type="button" className="swatch swatch-clear" title="Clear" aria-label="Clear" onClick={() => onPick(null)}>×</button>}
    </div>
  );
}

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

      {node.type !== "page" && (
        <>
          <div className="section-label">{t("builder.motion")}</div>
          <select className="select input-sm" value={String(node.props._motion ?? "")} onChange={(e) => st.update(node.id, { props: { _motion: e.target.value || undefined } })} aria-label={t("builder.motion")}>
            <option value="">— {t("builder.noMotion")} —</option>
            {(["hover", "press", "enter", "loop"] as const).map((g) => (
              <optgroup key={g} label={t(`builder.motion.${g}`)}>
                {MOTION_PRESETS.filter((m) => m.group === g).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
        </>
      )}

      <div className="section-label">{t("builder.style")}</div>
      <div className="prop-grid">
        {STYLE_FIELDS.map((f) => {
          const v = node.style[f.key] ?? "";
          // Sliders and the colour picker fire many events: coalesce them into one undo step.
          const set = (val: string | null, live = false) => st.update(node.id, { style: { [f.key]: val } }, live ? `style:${node.id}:${f.key}` : undefined);
          return (
            <div key={f.key} style={{ display: "contents" }}>
              <label>{f.label}</label>
              {f.kind === "color" ? (
                <ColorPick value={v} gradients={f.key === "background"} onPick={set} />
              ) : f.kind === "range" ? (
                <div className="row" style={{ gap: 8 }}>
                  <input type="range" min={0} max={100} step={5} className="grow" value={Math.round(Number(v === "" ? 1 : v) * 100)} onChange={(e) => set(String(Number(e.target.value) / 100), true)} aria-label={f.label} />
                  <span className="small mono muted" style={{ width: 36, textAlign: "right" }}>{Math.round(Number(v === "" ? 1 : v) * 100)}%</span>
                </div>
              ) : (
                <select className="select input-sm" value={v} onChange={(e) => set(e.target.value || null)} aria-label={f.label}>
                  <option value="">— default —</option>
                  {v && !f.options!.some(([o]) => o === v) && <option value={v}>{v}</option>}
                  {f.options!.map(([o, label]) => <option key={o} value={o}>{label}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(node.style).length > 0 && (
        <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => st.update(node.id, { style: Object.fromEntries(Object.keys(node.style).map((k) => [k, null])) })}>
          <I.IconRotate size={13} /> Clear styles
        </button>
      )}
    </div>
  );
}
