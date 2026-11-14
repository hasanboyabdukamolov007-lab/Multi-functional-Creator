import { useEffect, useRef, useState } from "react";
import { pickFile, downloadBlob, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { mediaApi, fmtSize } from "./mediaApi";
import { toBase64 } from "../deploy/deployApi";
import * as I from "../../ui/icons";

interface Text { text: string; x: number; y: number; size: number; color: string; weight: number }
interface State {
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  crop: { x: number; y: number; w: number; h: number } | null;
  filters: { brightness: number; contrast: number; saturate: number; grayscale: number; sepia: number; blur: number; hue: number };
  width: number | null;
  key: { color: string; tolerance: number } | null;
  texts: Text[];
}
const FRESH: State = { rotate: 0, flipX: false, flipY: false, crop: null, filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0, hue: 0 }, width: null, key: null, texts: [] };
const PRESETS: Array<[string, Partial<State["filters"]>]> = [["Original", {}], ["Vivid", { saturate: 140, contrast: 110 }], ["Mono", { grayscale: 100, contrast: 115 }], ["Warm", { sepia: 30, saturate: 120 }], ["Cool", { hue: 200, saturate: 90 }], ["Fade", { contrast: 85, brightness: 110, saturate: 80 }], ["Noir", { grayscale: 100, contrast: 150, brightness: 90 }]];
const ASPECTS: Array<[string, number | null]> = [["Free", null], ["1:1", 1], ["16:9", 16 / 9], ["4:3", 4 / 3], ["9:16", 9 / 16], ["3:2", 3 / 2]];

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Render the edit pipeline: rotate/flip → crop → filters + resize → colour key → text. */
function render(img: HTMLImageElement | ImageBitmap, s: State): HTMLCanvasElement {
  const rot = document.createElement("canvas");
  const swap = s.rotate === 90 || s.rotate === 270;
  rot.width = swap ? img.height : img.width;
  rot.height = swap ? img.width : img.height;
  const rc = rot.getContext("2d")!;
  rc.translate(rot.width / 2, rot.height / 2);
  rc.rotate((s.rotate * Math.PI) / 180);
  rc.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
  rc.drawImage(img, -img.width / 2, -img.height / 2);
  const c = s.crop ?? { x: 0, y: 0, w: rot.width, h: rot.height };
  const scale = s.width ? s.width / c.w : 1;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(c.w * scale));
  out.height = Math.max(1, Math.round(c.h * scale));
  const ctx = out.getContext("2d")!;
  const f = s.filters;
  ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hue}deg) blur(${f.blur}px)`;
  ctx.drawImage(rot, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  ctx.filter = "none";
  if (s.key) {
    const [kr, kg, kb] = rgb(s.key.color);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    const tol = (s.key.tolerance / 100) * 441;
    const soft = tol * 0.25;
    for (let i = 0; i < data.data.length; i += 4) {
      const d = Math.hypot(data.data[i] - kr, data.data[i + 1] - kg, data.data[i + 2] - kb);
      if (d <= tol) data.data[i + 3] = 0;
      else if (d <= tol + soft) data.data[i + 3] = Math.round(data.data[i + 3] * ((d - tol) / soft));
    }
    ctx.putImageData(data, 0, 0);
  }
  for (const t of s.texts) {
    ctx.font = `${t.weight} ${t.size * (out.width / 1000)}px system-ui, sans-serif`;
    ctx.fillStyle = t.color;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 8;
    ctx.fillText(t.text, (t.x / 100) * out.width, (t.y / 100) * out.height);
    ctx.shadowBlur = 0;
  }
  return out;
}

export function ImageEditor({ t, initial }: { t: (k: string, v?: Record<string, string | number>) => string; initial?: { url: string; name: string } | null }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState("image");
  const [s, setS] = useState<State>(FRESH);
  const [history, setHistory] = useState<State[]>([]);
  const [aspect, setAspect] = useState<number | null>(null);
  const [mode, setMode] = useState<"none" | "crop" | "pick">("none");
  const [format, setFormat] = useState<"image/webp" | "image/png" | "image/jpeg">("image/webp");
  const [quality, setQuality] = useState(0.85);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const load = (src: string, n: string) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => (setImg(im), setS(FRESH), setHistory([]), setName(n.replace(/\.[^.]+$/, "")));
    im.onerror = () => toast(t("media.loadFailed"), "error");
    im.src = src;
  };
  useEffect(() => {
    if (initial) load(initial.url, initial.name);
  }, [initial?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<State>) => {
    setHistory((h) => [...h.slice(-30), s]);
    setS({ ...s, ...patch });
  };
  // Live preview (the rotated, un-cropped image while cropping so the user sees the full frame).
  useEffect(() => {
    if (!img || !preview.current) return;
    const out = render(img, mode === "crop" ? { ...s, crop: null, width: null, texts: [] } : s);
    const cv = preview.current;
    cv.width = out.width;
    cv.height = out.height;
    cv.getContext("2d")!.drawImage(out, 0, 0);
  }, [img, s, mode]);

  const toImage = (e: React.PointerEvent) => {
    const r = preview.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * preview.current!.width, y: ((e.clientY - r.top) / r.height) * preview.current!.height };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!img) return;
    const p = toImage(e);
    if (mode === "pick") {
      const px = preview.current!.getContext("2d")!.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
      update({ key: { color: hex(px[0], px[1], px[2]), tolerance: s.key?.tolerance ?? 12 } });
      setMode("none");
      return;
    }
    if (mode === "crop") {
      drag.current = p;
      setSel({ x: p.x, y: p.y, w: 0, h: 0 });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (mode !== "crop" || !drag.current) return;
    const p = toImage(e);
    let w = p.x - drag.current.x;
    let h = p.y - drag.current.y;
    if (aspect) h = Math.sign(h || 1) * Math.abs(w) / aspect;
    setSel({ x: Math.min(drag.current.x, drag.current.x + w), y: Math.min(drag.current.y, drag.current.y + h), w: Math.abs(w), h: Math.abs(h) });
  };
  const applyCrop = () => {
    if (sel && sel.w > 4 && sel.h > 4) update({ crop: { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h) } });
    setSel(null);
    setMode("none");
  };

  const exportBlob = () =>
    new Promise<Blob>((resolve, reject) => {
      const out = render(img!, s);
      if (format === "image/jpeg") {
        const ctx = out.getContext("2d")!;
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, out.width, out.height);
      }
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), format, quality);
    });
  const ext = format === "image/png" ? "png" : format === "image/jpeg" ? "jpg" : "webp";
  const saveAsset = async () => {
    const b = await exportBlob();
    const out = render(img!, s);
    const r = await mediaApi.upload({ name: `${slugify(name) || "image"}.${ext}`, mime: format, data: toBase64(new Uint8Array(await b.arrayBuffer())), width: out.width, height: out.height, tags: ["edited"] });
    toast(t("media.savedAsset", { size: fmtSize(b.size) }), "success");
    void navigator.clipboard?.writeText(location.origin + r.url).catch(() => undefined);
  };

  if (!img)
    return (
      <div className="empty" style={{ margin: 16 }}>
        <p style={{ marginBottom: 12 }}>{t("media.openImageHint")}</p>
        <button className="btn btn-primary" onClick={() => void pickFile("image/*").then((f) => f && load(URL.createObjectURL(f), f.name))}><I.IconUpload size={14} /> {t("media.openImage")}</button>
      </div>
    );

  const F = s.filters;
  const slider = (k: keyof State["filters"], label: string, min: number, max: number) => (
    <label className="col" style={{ gap: 2 }}>
      <span className="row small" style={{ justifyContent: "space-between" }}><span>{label}</span><span className="muted">{F[k]}</span></span>
      <input type="range" min={min} max={max} value={F[k]} onChange={(e) => setS({ ...s, filters: { ...F, [k]: Number(e.target.value) } })} onPointerDown={() => setHistory((h) => [...h.slice(-30), s])} />
    </label>
  );
  return (
    <div className="editor-split">
      <div className="col" style={{ gap: 8, minWidth: 0 }}>
        <div className="toolbar" style={{ borderRadius: 10, border: "1px solid var(--mfc-border)" }}>
          <button className="icon-btn" title={t("media.undo")} disabled={!history.length} onClick={() => (setS(history[history.length - 1]), setHistory(history.slice(0, -1)))}><I.IconUndo size={16} /></button>
          <button className="icon-btn" title={t("media.rotate")} onClick={() => update({ rotate: (((s.rotate + 90) % 360) as State["rotate"]), crop: null })}><I.IconRotate size={16} /></button>
          <button className={`btn btn-sm ${s.flipX ? "btn-primary" : ""}`} onClick={() => update({ flipX: !s.flipX, crop: null })}>⇋</button>
          <button className={`btn btn-sm ${s.flipY ? "btn-primary" : ""}`} onClick={() => update({ flipY: !s.flipY, crop: null })}>⇵</button>
          <div className="toolbar-sep" />
          <button className={`btn btn-sm ${mode === "crop" ? "btn-primary" : ""}`} onClick={() => (mode === "crop" ? applyCrop() : setMode("crop"))}><I.IconCrop size={14} /> {mode === "crop" ? t("common.apply") : t("media.crop")}</button>
          {mode === "crop" && ASPECTS.map(([l, a]) => <button key={l} className={`btn btn-sm ${aspect === a ? "btn-primary" : "btn-ghost"}`} onClick={() => setAspect(a)}>{l}</button>)}
          {s.crop && mode !== "crop" && <button className="btn btn-sm btn-ghost" onClick={() => update({ crop: null })}>{t("media.uncrop")}</button>}
          <button className={`btn btn-sm ${mode === "pick" ? "btn-primary" : ""}`} title={t("media.removeBgHint")} onClick={() => setMode(mode === "pick" ? "none" : "pick")}><I.IconBrush size={14} /> {t("media.removeBg")}</button>
          <div className="grow" />
          <button className="btn btn-sm btn-ghost" onClick={() => void pickFile("image/*").then((f) => f && load(URL.createObjectURL(f), f.name))}><I.IconUpload size={14} /></button>
        </div>
        <div className="image-stage checker">
          <canvas ref={preview} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} style={{ cursor: mode === "none" ? "default" : "crosshair", touchAction: "none" }} aria-label={name} />
          {mode === "crop" && sel && preview.current && (
            <div className="crop-box" style={{ left: `${(sel.x / preview.current.width) * 100}%`, top: `${(sel.y / preview.current.height) * 100}%`, width: `${(sel.w / preview.current.width) * 100}%`, height: `${(sel.h / preview.current.height) * 100}%` }} />
          )}
        </div>
        <span className="small muted">{t("media.original")}: {img.width}×{img.height}{mode === "crop" ? ` · ${t("media.cropHint")}` : mode === "pick" ? ` · ${t("media.pickHint")}` : ""}</span>
      </div>
      <aside className="card col" style={{ gap: 10, alignSelf: "start" }}>
        <div className="row wrap" style={{ gap: 4 }}>{PRESETS.map(([l, p]) => <button key={l} className="chip" onClick={() => update({ filters: { ...FRESH.filters, ...p } })}>{l}</button>)}</div>
        {slider("brightness", t("media.f.brightness"), 0, 200)}
        {slider("contrast", t("media.f.contrast"), 0, 200)}
        {slider("saturate", t("media.f.saturation"), 0, 200)}
        {slider("hue", t("media.f.hue"), 0, 360)}
        {slider("grayscale", t("media.f.grayscale"), 0, 100)}
        {slider("sepia", t("media.f.sepia"), 0, 100)}
        {slider("blur", t("media.f.blur"), 0, 20)}
        {s.key && (
          <label className="col" style={{ gap: 2 }}>
            <span className="row small" style={{ gap: 6 }}><span className="swatch" style={{ width: 16, height: 16, background: s.key.color }} /> {t("media.tolerance")} {s.key.tolerance}% <button className="btn btn-sm btn-ghost" onClick={() => update({ key: null })}>✕</button></span>
            <input type="range" min={1} max={60} value={s.key.tolerance} onChange={(e) => setS({ ...s, key: { ...s.key!, tolerance: Number(e.target.value) } })} />
          </label>
        )}
        <div className="section-label">{t("media.text")}</div>
        {s.texts.map((tx, i) => (
          <div key={i} className="col" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 4 }}>
              <input className="input input-sm grow" value={tx.text} onChange={(e) => setS({ ...s, texts: s.texts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <input type="color" value={tx.color} onChange={(e) => setS({ ...s, texts: s.texts.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} aria-label="Color" />
              <button className="icon-btn" onClick={() => update({ texts: s.texts.filter((_, j) => j !== i) })} aria-label={t("common.delete")}><I.IconTrash size={13} /></button>
            </div>
            <div className="row small" style={{ gap: 6 }}>
              <input type="range" min={0} max={100} value={tx.y} onChange={(e) => setS({ ...s, texts: s.texts.map((x, j) => (j === i ? { ...x, y: Number(e.target.value) } : x)) })} aria-label="Y" />
              <input type="range" min={20} max={200} value={tx.size} onChange={(e) => setS({ ...s, texts: s.texts.map((x, j) => (j === i ? { ...x, size: Number(e.target.value) } : x)) })} aria-label="Size" />
            </div>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => update({ texts: [...s.texts, { text: "Headline", x: 50, y: 85, size: 70, color: "#ffffff", weight: 800 }] })}><I.IconType size={13} /> {t("media.addText")}</button>
        <div className="section-label">{t("media.export")}</div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input input-sm" type="number" min={16} max={8000} placeholder={t("media.width")} value={s.width ?? ""} onChange={(e) => setS({ ...s, width: e.target.value ? Number(e.target.value) : null })} aria-label={t("media.width")} />
          <select className="select input-sm" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} aria-label="Format">
            <option value="image/webp">WebP</option><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option>
          </select>
        </div>
        {format !== "image/png" && <label className="row small" style={{ gap: 6 }}>{t("media.quality")} <input type="range" min={0.4} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /> {Math.round(quality * 100)}</label>}
        <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("common.name")} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-primary grow" onClick={() => void saveAsset().catch((e: Error) => toast(e.message, "error"))}><I.IconSave size={13} /> {t("media.saveToAssets")}</button>
          <button className="btn btn-sm" onClick={() => void exportBlob().then((b) => downloadBlob(`${slugify(name) || "image"}.${ext}`, b))}><I.IconDownload size={13} /></button>
        </div>
      </aside>
    </div>
  );
}
