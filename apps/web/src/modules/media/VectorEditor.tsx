import { useRef, useState } from "react";
import { downloadBlob, downloadText, slugify } from "../../lib/download";
import { toast, copyText } from "../../lib/ui";
import { mediaApi } from "./mediaApi";
import { toBase64 } from "../deploy/deployApi";
import * as I from "../../ui/icons";

type Tool = "select" | "rect" | "ellipse" | "line" | "pen" | "text";
interface Shape {
  id: string;
  type: "rect" | "ellipse" | "line" | "path" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
  points?: Array<[number, number]>;
  text?: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  opacity: number;
  fontSize: number;
}
const uid = () => Math.random().toString(36).slice(2, 9);
const SNAP = 8;
const snap = (v: number, on: boolean) => (on ? Math.round(v / SNAP) * SNAP : Math.round(v));

function shapeSvg(s: Shape): string {
  const common = `fill="${s.type === "line" ? "none" : s.fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" opacity="${s.opacity}"`;
  switch (s.type) {
    case "rect":
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.radius}" ${common}/>`;
    case "ellipse":
      return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" ${common}/>`;
    case "line":
      return `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" ${common} stroke-linecap="round"/>`;
    case "path":
      return `<path d="${(s.points ?? []).map(([px, py], i) => `${i ? "L" : "M"}${px + s.x} ${py + s.y}`).join(" ")}" ${common} stroke-linecap="round" stroke-linejoin="round"/>`;
    case "text":
      return `<text x="${s.x}" y="${s.y + s.fontSize}" font-family="system-ui, sans-serif" font-size="${s.fontSize}" font-weight="700" fill="${s.fill}" opacity="${s.opacity}">${(s.text ?? "").replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</text>`;
  }
}
export const toSvg = (shapes: Shape[], w: number, h: number, bg: string | null) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ""}${shapes.map(shapeSvg).join("")}</svg>`;

export function VectorEditor({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [sel, setSel] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [bg, setBg] = useState<string | null>("#ffffff");
  const [snapOn, setSnapOn] = useState(true);
  const [name, setName] = useState("vector");
  const [style, setStyle] = useState({ fill: "#6d5efc", stroke: "#1e1b4b", strokeWidth: 2 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: "create" | "move" | "resize"; id: string; ox: number; oy: number; start: Shape } | null>(null);
  const current = shapes.find((s) => s.id === sel) ?? null;
  const patch = (id: string, p: Partial<Shape>) => setShapes((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };

  const down = (e: React.PointerEvent) => {
    const p = pt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const hitId = (e.target as Element).getAttribute("data-id");
    const handle = (e.target as Element).getAttribute("data-handle");
    if (tool === "select") {
      if (handle && current) drag.current = { mode: "resize", id: current.id, ox: p.x, oy: p.y, start: { ...current } };
      else if (hitId) {
        setSel(hitId);
        const s = shapes.find((x) => x.id === hitId)!;
        drag.current = { mode: "move", id: hitId, ox: p.x, oy: p.y, start: { ...s } };
      } else setSel(null);
      return;
    }
    const base: Shape = { id: uid(), type: tool === "pen" ? "path" : (tool as Shape["type"]), x: snap(p.x, snapOn), y: snap(p.y, snapOn), w: 0, h: 0, fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, radius: 8, opacity: 1, fontSize: 48 };
    if (tool === "text") {
      const s = { ...base, text: t("media.textDefault"), w: 300, h: 60 };
      setShapes([...shapes, s]);
      setSel(s.id);
      setTool("select");
      return;
    }
    if (tool === "pen") base.points = [[0, 0]];
    setShapes([...shapes, base]);
    setSel(base.id);
    drag.current = { mode: "create", id: base.id, ox: base.x, oy: base.y, start: base };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pt(e);
    if (d.mode === "move") patch(d.id, { x: snap(d.start.x + p.x - d.ox, snapOn), y: snap(d.start.y + p.y - d.oy, snapOn) });
    else if (d.mode === "resize") patch(d.id, { w: Math.max(4, snap(d.start.w + p.x - d.ox, snapOn)), h: Math.max(4, snap(d.start.h + p.y - d.oy, snapOn)) });
    else if (d.start.type === "path") setShapes((xs) => xs.map((s) => (s.id === d.id ? { ...s, points: [...(s.points ?? []), [Math.round(p.x - s.x), Math.round(p.y - s.y)]] } : s)));
    else if (d.start.type === "line") patch(d.id, { w: snap(p.x, snapOn) - d.ox, h: snap(p.y, snapOn) - d.oy });
    else {
      const x2 = snap(p.x, snapOn);
      const y2 = snap(p.y, snapOn);
      patch(d.id, { x: Math.min(d.ox, x2), y: Math.min(d.oy, y2), w: Math.abs(x2 - d.ox), h: Math.abs(y2 - d.oy) });
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "create") {
      const s = shapes.find((x) => x.id === d.id);
      if (s && s.type !== "path" && s.type !== "line" && (s.w < 3 || s.h < 3)) patch(d.id, { w: 120, h: 90 });
    }
  };
  const order = (dir: 1 | -1) => {
    if (!current) return;
    const i = shapes.indexOf(current);
    const j = Math.max(0, Math.min(shapes.length - 1, i + dir));
    const next = [...shapes];
    [next[i], next[j]] = [next[j], next[i]];
    setShapes(next);
  };
  const svgText = () => toSvg(shapes, size.w, size.h, bg);
  const png = () =>
    new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = size.w * 2;
        c.height = size.h * 2;
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png");
      };
      img.onerror = reject;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText())}`;
    });

  const tools: Array<[Tool, string, string]> = [["select", "↖", t("media.v.select")], ["rect", "▭", t("media.v.rect")], ["ellipse", "◯", t("media.v.ellipse")], ["line", "╱", t("media.v.line")], ["pen", "✎", t("media.v.pen")], ["text", "T", t("media.v.text")]];
  return (
    <div className="editor-split">
      <div className="col" style={{ gap: 8, minWidth: 0 }}>
        <div className="toolbar" style={{ borderRadius: 10, border: "1px solid var(--mfc-border)" }}>
          {tools.map(([id, glyph, label]) => <button key={id} className={`icon-btn ${tool === id ? "active" : ""}`} title={label} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)} style={{ fontWeight: 700 }}>{glyph}</button>)}
          <div className="toolbar-sep" />
          <input type="color" value={style.fill} onChange={(e) => (setStyle({ ...style, fill: e.target.value }), current && patch(current.id, { fill: e.target.value }))} title={t("media.v.fill")} aria-label={t("media.v.fill")} />
          <input type="color" value={style.stroke} onChange={(e) => (setStyle({ ...style, stroke: e.target.value }), current && patch(current.id, { stroke: e.target.value }))} title={t("media.v.stroke")} aria-label={t("media.v.stroke")} />
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> {t("media.v.snap")}</label>
          <div className="grow" />
          <button className="icon-btn" disabled={!current} title={t("media.v.forward")} onClick={() => order(1)}><I.IconArrowUp size={15} /></button>
          <button className="icon-btn" disabled={!current} title={t("media.v.backward")} onClick={() => order(-1)}><I.IconArrowDown size={15} /></button>
          <button className="icon-btn" disabled={!current} title={t("common.delete")} onClick={() => (setShapes(shapes.filter((s) => s !== current)), setSel(null))}><I.IconTrash size={15} /></button>
        </div>
        <div className="image-stage checker" style={{ padding: 12 }}>
          <svg ref={svg} viewBox={`0 0 ${size.w} ${size.h}`} style={{ width: "100%", maxHeight: "68vh", background: bg ?? "transparent", touchAction: "none", cursor: tool === "select" ? "default" : "crosshair", boxShadow: "var(--mfc-shadow)" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} role="img" aria-label={name}>
            {shapes.map((s) => <g key={s.id} data-id={s.id} dangerouslySetInnerHTML={{ __html: shapeSvg(s).replace(/^<(\w+)/, `<$1 data-id="${s.id}" style="cursor:move"`) }} />)}
            {current && current.type !== "path" && (
              <g pointerEvents="none">
                <rect x={Math.min(current.x, current.x + current.w) - 3} y={Math.min(current.y, current.y + (current.type === "text" ? current.fontSize : current.h)) - 3} width={Math.abs(current.w) + 6} height={Math.abs(current.type === "text" ? current.fontSize * 1.3 : current.h) + 6} fill="none" stroke="#6d5efc" strokeDasharray="4 3" />
              </g>
            )}
            {current && tool === "select" && current.type !== "text" && current.type !== "path" && <rect data-handle="se" x={current.x + current.w - 6} y={current.y + current.h - 6} width={12} height={12} fill="#fff" stroke="#6d5efc" strokeWidth={2} style={{ cursor: "nwse-resize" }} />}
          </svg>
        </div>
      </div>
      <aside className="card col" style={{ gap: 10, alignSelf: "start" }}>
        <div className="section-label">{t("media.v.canvas")}</div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input input-sm" type="number" value={size.w} onChange={(e) => setSize({ ...size, w: Math.max(16, Number(e.target.value)) })} aria-label="Width" />
          <input className="input input-sm" type="number" value={size.h} onChange={(e) => setSize({ ...size, h: Math.max(16, Number(e.target.value)) })} aria-label="Height" />
        </div>
        <div className="row wrap" style={{ gap: 4 }}>{[[800, 600], [1080, 1080], [1200, 630], [1920, 1080], [512, 512]].map(([w, h]) => <button key={`${w}x${h}`} className="chip" onClick={() => setSize({ w, h })}>{w}×{h}</button>)}</div>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!bg} onChange={(e) => setBg(e.target.checked ? "#ffffff" : null)} /> {t("media.v.background")} {bg && <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background" />}</label>
        {current && (
          <>
            <div className="section-label">{t("media.v.shape")}</div>
            {current.type === "text" && <input className="input input-sm" value={current.text} onChange={(e) => patch(current.id, { text: e.target.value })} aria-label={t("media.v.text")} />}
            {current.type === "text" && <label className="col small" style={{ gap: 2 }}>{t("media.v.fontSize")} <input type="range" min={10} max={200} value={current.fontSize} onChange={(e) => patch(current.id, { fontSize: Number(e.target.value) })} /></label>}
            {current.type !== "text" && <label className="col small" style={{ gap: 2 }}>{t("media.v.strokeWidth")} {current.strokeWidth} <input type="range" min={0} max={24} value={current.strokeWidth} onChange={(e) => patch(current.id, { strokeWidth: Number(e.target.value) })} /></label>}
            {current.type === "rect" && <label className="col small" style={{ gap: 2 }}>{t("media.v.radius")} {current.radius} <input type="range" min={0} max={200} value={current.radius} onChange={(e) => patch(current.id, { radius: Number(e.target.value) })} /></label>}
            <label className="col small" style={{ gap: 2 }}>{t("media.v.opacity")} {Math.round(current.opacity * 100)}% <input type="range" min={0.05} max={1} step={0.05} value={current.opacity} onChange={(e) => patch(current.id, { opacity: Number(e.target.value) })} /></label>
          </>
        )}
        <div className="section-label">{t("media.export")}</div>
        <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("common.name")} />
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-primary" disabled={!shapes.length} onClick={() => void mediaApi.upload({ name: `${slugify(name) || "vector"}.svg`, mime: "image/svg+xml", data: toBase64(svgText()), width: size.w, height: size.h, tags: ["vector"] }).then(() => toast(t("media.savedAsset", { size: `${Math.round(svgText().length / 1024)} KB` }), "success")).catch((e: Error) => toast(e.message, "error"))}><I.IconSave size={13} /> {t("media.saveToAssets")}</button>
          <button className="btn btn-sm" disabled={!shapes.length} onClick={() => downloadText(`${slugify(name) || "vector"}.svg`, svgText(), "image/svg+xml")}>SVG</button>
          <button className="btn btn-sm" disabled={!shapes.length} onClick={() => void png().then((b) => downloadBlob(`${slugify(name) || "vector"}.png`, b))}>PNG</button>
          <button className="btn btn-sm btn-ghost" disabled={!shapes.length} onClick={() => void copyText(svgText(), t("common.copied"))}><I.IconCopy size={13} /></button>
        </div>
      </aside>
    </div>
  );
}
