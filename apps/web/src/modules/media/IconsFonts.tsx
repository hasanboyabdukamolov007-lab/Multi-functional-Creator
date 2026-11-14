import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FONTS, loadFont } from "../../lib/fonts";
import { useBuilder } from "../builder/store";
import { n } from "../builder/model";
import { downloadText } from "../../lib/download";
import { toast, copyText } from "../../lib/ui";
import { mediaApi } from "./mediaApi";
import { toBase64 } from "../deploy/deployApi";

type IconComp = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;

/** Render a lucide icon component to a standalone SVG string. */
function iconSvg(C: IconComp, size: number, stroke: number, color: string): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<C size={size} strokeWidth={stroke} color={color} />));
  const svg = host.innerHTML.replace(/ class="[^"]*"/, "").replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  root.unmount();
  return svg;
}

export function Icons({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const [all, setAll] = useState<Array<[string, IconComp]> | null>(null);
  const [q, setQ] = useState("");
  const [size, setSize] = useState(48);
  const [stroke, setStroke] = useState(2);
  const [color, setColor] = useState("#6d5efc");
  const [picked, setPicked] = useState<string | null>(null);
  const builderOpen = useBuilder((s) => !!s.projectId);
  useEffect(() => {
    // The full icon set loads only when this tab opens.
    void import("lucide-react").then((m) =>
      setAll(
        Object.entries(m)
          .filter(([k, v]) => /^[A-Z][A-Za-z0-9]+$/.test(k) && !k.endsWith("Icon") && !k.startsWith("Lucide") && typeof v === "object" && v !== null && "render" in (v as object))
          .map(([k, v]) => [k, v as IconComp]),
      ),
    );
  }, []);
  const shown = useMemo(() => {
    if (!all) return [];
    const s = q.trim().toLowerCase().replace(/\s+/g, "");
    return (s ? all.filter(([k]) => k.toLowerCase().includes(s)) : all).slice(0, 240);
  }, [all, q]);
  const cur = all?.find(([k]) => k === picked);
  const svg = cur ? iconSvg(cur[1], size, stroke, color) : "";
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder={t("media.icons.search", { n: all?.length ?? "…" })} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
        <label className="row small" style={{ gap: 4 }}>{t("media.icons.size")} <input type="range" min={16} max={128} value={size} onChange={(e) => setSize(Number(e.target.value))} /> {size}</label>
        <label className="row small" style={{ gap: 4 }}>{t("media.icons.stroke")} <input type="range" min={1} max={3} step={0.25} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} /> {stroke}</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
      </div>
      {cur && (
        <div className="card row wrap" style={{ gap: 12 }}>
          <span dangerouslySetInnerHTML={{ __html: svg }} />
          <strong className="grow">{kebab(cur[0])}</strong>
          <button className="btn btn-sm" onClick={() => void copyText(svg, t("common.copied"))}>{t("media.icons.copySvg")}</button>
          <button className="btn btn-sm" onClick={() => downloadText(`${kebab(cur[0])}.svg`, svg, "image/svg+xml")}>SVG</button>
          <button className="btn btn-sm" onClick={() => void mediaApi.upload({ name: `${kebab(cur[0])}.svg`, mime: "image/svg+xml", data: toBase64(svg), width: size, height: size, tags: ["icon"] }).then(() => toast(t("media.savedAsset", { size: `${svg.length} B` }), "success"))}>{t("media.saveToAssets")}</button>
          <button className="btn btn-sm btn-primary" disabled={!builderOpen} title={builderOpen ? "" : t("builder.openProject")} onClick={() => (useBuilder.getState().insert(n("html", { html: svg })), toast(t("media.icons.inserted"), "success"))}>{t("media.icons.insert")}</button>
        </div>
      )}
      {!all ? <div className="muted">{t("common.loading")}</div> : (
        <div className="icon-grid">
          {shown.map(([k, C]) => (
            <button key={k} className={`icon-cell ${picked === k ? "active" : ""}`} title={kebab(k)} aria-label={kebab(k)} onClick={() => setPicked(k)}>
              <C size={22} strokeWidth={stroke} />
            </button>
          ))}
        </div>
      )}
      {all && shown.length === 240 && <span className="hint">{t("media.icons.more")}</span>}
    </div>
  );
}

export function Fonts({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const [sample, setSample] = useState("Salom dunyo — Привет, мир — Hello world 0123");
  const [kind, setKind] = useState<"" | "sans" | "serif" | "display" | "mono">("");
  const [cyr, setCyr] = useState(false);
  const list = FONTS.filter((f) => (!kind || f.kind === kind) && (!cyr || f.cyrillic));
  useEffect(() => list.forEach((f) => loadFont(f.name)), [list]);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ maxWidth: 420 }} value={sample} onChange={(e) => setSample(e.target.value)} aria-label={t("media.fonts.sample")} />
        <select className="select" style={{ width: 140 }} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("media.fonts.kind")}>
          <option value="">{t("home.allKinds")}</option><option value="sans">Sans</option><option value="serif">Serif</option><option value="display">Display</option><option value="mono">Mono</option>
        </select>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={cyr} onChange={(e) => setCyr(e.target.checked)} /> {t("media.fonts.cyrillic")}</label>
      </div>
      <p className="hint">{t("media.fonts.hint")}</p>
      {list.map((f) => (
        <div key={f.name} className="card col" style={{ gap: 4 }}>
          <div className="row small muted" style={{ gap: 8 }}><strong style={{ color: "var(--mfc-text)" }}>{f.name}</strong> {f.kind}{f.cyrillic ? " · Cyrillic" : ""}</div>
          <div style={{ fontFamily: `"${f.name}"`, fontSize: 26, lineHeight: 1.25 }}>{sample}</div>
        </div>
      ))}
    </div>
  );
}
