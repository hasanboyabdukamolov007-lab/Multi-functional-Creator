import { useEffect, useState } from "react";
import { mediaApi, uploadFile, type BrandKit as Kit } from "./mediaApi";
import { FONTS, fontStack, loadFont } from "../../lib/fonts";
import { contrastRatio } from "../builder/a11y";
import { onColor } from "../copilot/engine/pageGen";
import { useBuilder } from "../builder/store";
import { useTheme } from "../../lib/theme";
import { pickFile, downloadText } from "../../lib/download";
import { toast } from "../../lib/ui";
import * as I from "../../ui/icons";

const EMPTY: Kit = { name: "", tagline: "", logoId: null, logoUrl: null, colors: [{ name: "primary", value: "#6d5efc" }, { name: "accent", value: "#ec4899" }, { name: "ink", value: "#14161f" }, { name: "paper", value: "#ffffff" }], fonts: { heading: "Manrope", body: "Inter" }, radius: "12px", voice: "" };

/** Workspace brand kit: logo, palette with contrast checks, type pairing, shape and voice — applied anywhere in one click. */
export function BrandKit({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [dirty, setDirty] = useState(false);
  const builderOpen = useBuilder((s) => !!s.projectId);
  useEffect(() => {
    mediaApi.brand().then((b) => setKit(b ? { ...EMPTY, ...b } : EMPTY)).catch(() => setKit(EMPTY));
  }, []);
  useEffect(() => {
    if (!kit) return;
    loadFont(kit.fonts.heading);
    loadFont(kit.fonts.body);
  }, [kit?.fonts.heading, kit?.fonts.body]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!kit) return <div className="muted">{t("common.loading")}</div>;
  const set = (p: Partial<Kit>) => (setKit({ ...kit, ...p }), setDirty(true));
  const primary = kit.colors[0]?.value ?? "#6d5efc";
  const css = `:root {\n${kit.colors.map((c) => `  --brand-${c.name.toLowerCase().replace(/\W+/g, "-")}: ${c.value};`).join("\n")}\n  --brand-font-heading: ${fontStack(kit.fonts.heading)};\n  --brand-font-body: ${fontStack(kit.fonts.body)};\n  --brand-radius: ${kit.radius};\n}`;

  const applyToProject = () => {
    useBuilder.getState().mutate((doc) => {
      Object.assign(doc.tokens, { primary, primaryText: onColor(primary), font: fontStack(kit.fonts.body), headingFont: fontStack(kit.fonts.heading), radius: kit.radius });
    });
    toast(t("brand.appliedProject"), "success");
  };
  const applyToPanel = () => {
    const th = useTheme.getState();
    const base = th.active().tokens;
    th.saveCustom(`${kit.name || "Brand"} theme`, { ...base, accent: primary, accentText: onColor(primary) } as typeof base);
    toast(t("brand.appliedPanel"), "success");
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card brand-preview" style={{ borderRadius: kit.radius }}>
        <div className="row" style={{ gap: 14 }}>
          {kit.logoUrl ? <img src={kit.logoUrl} alt={`${kit.name} logo`} style={{ height: 56, maxWidth: 160, objectFit: "contain" }} /> : <span className="brand-mark" style={{ width: 56, height: 56, fontSize: 24, background: primary }}>{(kit.name || "B")[0]}</span>}
          <div className="col" style={{ gap: 2 }}>
            <strong style={{ fontFamily: fontStack(kit.fonts.heading), fontSize: 28 }}>{kit.name || t("brand.yourBrand")}</strong>
            <span style={{ fontFamily: fontStack(kit.fonts.body) }} className="muted">{kit.tagline || t("brand.taglineHint")}</span>
          </div>
          <div className="grow" />
          <button className="btn" style={{ background: primary, color: onColor(primary), borderRadius: kit.radius, border: 0, fontFamily: fontStack(kit.fonts.body) }}>{t("brand.sampleButton")}</button>
        </div>
      </div>

      <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
        <div className="card col" style={{ gap: 10 }}>
          <strong>{t("brand.identity")}</strong>
          <input className="input" placeholder={t("brand.name")} value={kit.name} onChange={(e) => set({ name: e.target.value })} />
          <input className="input" placeholder={t("brand.tagline")} value={kit.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void pickFile("image/*").then(async (f) => { if (!f) return; const r = await uploadFile(f, { tags: ["logo", "brand"], optimize: f.type !== "image/svg+xml" }); set({ logoId: r.id, logoUrl: r.url }); })}><I.IconUpload size={13} /> {t("brand.logo")}</button>
            {kit.logoUrl && <button className="btn btn-sm btn-ghost" onClick={() => set({ logoId: null, logoUrl: null })}>{t("common.delete")}</button>}
          </div>
          <textarea className="textarea" rows={3} placeholder={t("brand.voiceHint")} value={kit.voice} onChange={(e) => set({ voice: e.target.value })} />
        </div>

        <div className="card col" style={{ gap: 8 }}>
          <strong>{t("brand.palette")}</strong>
          {kit.colors.map((c, i) => {
            const onWhite = contrastRatio(c.value, "#ffffff") ?? 0;
            const onBlack = contrastRatio(c.value, "#000000") ?? 0;
            return (
              <div key={i} className="row" style={{ gap: 6 }}>
                <input type="color" value={c.value} onChange={(e) => set({ colors: kit.colors.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} aria-label={c.name} />
                <input className="input input-sm" style={{ width: 110 }} value={c.name} onChange={(e) => set({ colors: kit.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Name" />
                <code className="small">{c.value}</code>
                <span className="small muted grow" title={t("brand.contrastHint")}>⬜ {onWhite.toFixed(1)} {onWhite >= 4.5 ? "✓" : "✕"} · ⬛ {onBlack.toFixed(1)} {onBlack >= 4.5 ? "✓" : "✕"}</span>
                <button className="icon-btn" aria-label={t("common.delete")} onClick={() => set({ colors: kit.colors.filter((_, j) => j !== i) })}><I.IconClose size={12} /></button>
              </div>
            );
          })}
          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ colors: [...kit.colors, { name: `color-${kit.colors.length + 1}`, value: "#0ea5e9" }] })}><I.IconPlus size={13} /> {t("brand.addColor")}</button>
          <p className="hint">{t("brand.paletteHint")}</p>
        </div>

        <div className="card col" style={{ gap: 8 }}>
          <strong>{t("brand.type")}</strong>
          {(["heading", "body"] as const).map((k) => (
            <label key={k} className="col" style={{ gap: 4 }}><span className="label">{t(`brand.font.${k}`)}</span>
              <select className="select" value={kit.fonts[k]} onChange={(e) => set({ fonts: { ...kit.fonts, [k]: e.target.value } })}>
                {FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}{f.cyrillic ? " · Кир" : ""}</option>)}
              </select></label>
          ))}
          <p style={{ fontFamily: fontStack(kit.fonts.heading), fontSize: 22, fontWeight: 700, margin: 0 }}>Aa Bb Cc — Салом, Привет</p>
          <p style={{ fontFamily: fontStack(kit.fonts.body), margin: 0 }} className="muted">The quick brown fox jumps over the lazy dog. Tez qo‘ng‘ir tulki dangasa it ustidan sakraydi.</p>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("brand.radius")} · {kit.radius}</span>
            <input type="range" min={0} max={28} value={parseInt(kit.radius)} onChange={(e) => set({ radius: `${e.target.value}px` })} /></label>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void mediaApi.saveBrand(kit).then(() => (setDirty(false), toast(t("common.saved"), "success"))).catch((e: Error) => toast(e.message, "error"))}><I.IconSave size={14} /> {t("common.save")}</button>
        <button className="btn" disabled={!builderOpen} title={builderOpen ? "" : t("builder.openProject")} onClick={applyToProject}><I.IconBuilder size={14} /> {t("brand.applyProject")}</button>
        <button className="btn" onClick={applyToPanel}><I.IconPalette size={14} /> {t("brand.applyPanel")}</button>
        <button className="btn btn-ghost" onClick={() => downloadText("brand-tokens.css", css, "text/css")}>tokens.css</button>
        <button className="btn btn-ghost" onClick={() => downloadText("brand-kit.json", JSON.stringify(kit, null, 2), "application/json")}>brand.json</button>
      </div>
    </div>
  );
}
