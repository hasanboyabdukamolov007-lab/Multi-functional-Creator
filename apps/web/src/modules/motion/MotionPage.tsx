import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { toast, copyText } from "../../lib/ui";
import { downloadBlob, downloadText, pickFile } from "../../lib/download";
import { recordCanvas, canRecordWebm } from "../../lib/recorder";
import { useBuilder } from "../builder/store";
import { n } from "../builder/model";
import { MOTION_CSS, MOTION_PRESETS } from "../builder/motion";
import { mediaApi } from "../media/mediaApi";
import { toBase64 } from "../deploy/deployApi";
import { EASES, RANGE, STARTER, bezierAt, sample, toCss, toWaapi, type Anim, type Bezier, type Prop } from "./timeline";
import * as I from "../../ui/icons";

type T = (k: string, v?: Record<string, string | number>) => string;

function Presets({ t }: { t: T }) {
  const [replay, setReplay] = useState(0);
  const selected = useBuilder((s) => s.selectedId);
  const apply = (id: string) => {
    const st = useBuilder.getState();
    if (!st.selectedId) return toast(t("motion.selectFirst"), "warning");
    st.update(st.selectedId, { props: { _motion: id } });
    toast(t("motion.applied"), "success");
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <style>{MOTION_CSS}</style>
      <div className="row"><p className="hint grow">{t("motion.presetsHint")}</p><button className="btn btn-sm" onClick={() => setReplay((r) => r + 1)}><I.IconRotate size={13} /> {t("motion.replay")}</button></div>
      {(["hover", "press", "enter", "loop"] as const).map((g) => (
        <div key={g} className="col" style={{ gap: 8 }}>
          <div className="section-label">{t(`builder.motion.${g}`)}</div>
          <div className="grid-auto mfc-motion" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 10 }} key={`${g}-${replay}`}>
            {MOTION_PRESETS.filter((m) => m.group === g).map((m) => (
              <div key={m.id} className="card col" style={{ gap: 10, alignItems: "center" }}>
                <div data-motion={m.id} className={`motion-demo ${g === "enter" ? "mfc-in" : ""}`}>{g === "hover" || g === "press" ? t("motion.tryHover") : "✦"}</div>
                <strong className="small">{m.label}</strong>
                <button className="btn btn-sm" disabled={!selected} title={selected ? "" : t("motion.selectFirst")} onClick={() => apply(m.id)}>{t("motion.applyToSelected")}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BezierEditor({ value, onChange }: { value: Bezier; onChange: (b: Bezier) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const S = 160;
  const P = 30;
  const toPx = (x: number, y: number) => [P + x * S, P + (1 - y) * S] as const;
  const move = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    const r = box.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width) * (S + 2 * P) / S - P / S));
    const y = Math.max(-1, Math.min(2, 1 - (((e.clientY - r.top) / r.height) * (S + 2 * P) - P) / S));
    const next = [...value] as Bezier;
    next[drag.current * 2] = +x.toFixed(3);
    next[drag.current * 2 + 1] = +y.toFixed(3);
    onChange(next);
  };
  const curve = Array.from({ length: 41 }, (_, i) => i / 40).map((x) => toPx(x, bezierAt(value, x)).join(",")).join(" ");
  const [a, b] = [toPx(value[0], value[1]), toPx(value[2], value[3])];
  return (
    <svg ref={box} viewBox={`0 0 ${S + 2 * P} ${S + 2 * P}`} width="100%" style={{ maxWidth: 240, touchAction: "none", display: "block" }} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)} role="img" aria-label={`cubic-bezier(${value.join(", ")})`}>
      <rect x={P} y={P} width={S} height={S} fill="none" stroke="var(--mfc-border)" />
      <line x1={P} y1={P + S} x2={a[0]} y2={a[1]} stroke="var(--mfc-muted)" strokeDasharray="3 3" />
      <line x1={P + S} y1={P} x2={b[0]} y2={b[1]} stroke="var(--mfc-muted)" strokeDasharray="3 3" />
      <polyline points={curve} fill="none" stroke="var(--mfc-accent)" strokeWidth={3} />
      {[a, b].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={8} fill="var(--mfc-surface)" stroke="var(--mfc-accent)" strokeWidth={3} style={{ cursor: "grab" }} onPointerDown={(e) => ((drag.current = i as 0 | 1), (e.target as Element).setPointerCapture(e.pointerId))} />)}
    </svg>
  );
}

function Timeline({ t }: { t: T }) {
  const [anim, setAnim] = useState<Anim>(() => structuredClone(STARTER));
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [sel, setSel] = useState<{ prop: Prop; i: number } | null>({ prop: "x", i: 1 });
  const [rec, setRec] = useState<{ p: number; ac: AbortController } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef({ p: 0 });

  const draw = (pp: number) => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const v = sample(anim, pp);
    ctx.clearRect(0, 0, c.width, c.height);
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, "#0f1220");
    g.addColorStop(1, "#1b1e33");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, v.opacity));
    ctx.translate(c.width / 2 + v.x, c.height / 2 + v.y);
    ctx.rotate((v.rotate * Math.PI) / 180);
    ctx.scale(v.scale, v.scale);
    ctx.fillStyle = anim.color;
    if (anim.shape === "box") {
      ctx.beginPath();
      ctx.roundRect(-40, -40, 80, 80, 18);
      ctx.fill();
    } else if (anim.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = anim.shape === "emoji" ? "72px system-ui" : "800 56px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(anim.shape === "emoji" ? anim.label || "🚀" : anim.label, 0, 0);
    }
    ctx.restore();
  };
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (playing) {
        let next = clock.current.p + (now - last) / 1000 / anim.duration;
        if (next > 1) next = anim.loop ? next % 1 : 1;
        clock.current.p = next;
        setP(next);
      }
      last = now;
      draw(clock.current.p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const key = sel ? [...anim.tracks[sel.prop]].sort((a, b) => a.t - b.t)[sel.i] : null;
  const setKey = (patch: Partial<{ t: number; v: number; ease: Bezier }>) => {
    if (!sel || !key) return;
    const tracks = { ...anim.tracks, [sel.prop]: anim.tracks[sel.prop].map((k) => (k === key ? { ...k, ...patch } : k)) };
    setAnim({ ...anim, tracks });
  };
  const addKey = (prop: Prop) => {
    const v = sample(anim, p)[prop];
    const keys = [...anim.tracks[prop].filter((k) => Math.abs(k.t - p) > 0.005), { t: +p.toFixed(3), v: +v.toFixed(2), ease: EASES["ease-in-out"] }].sort((a, b) => a.t - b.t);
    setAnim({ ...anim, tracks: { ...anim.tracks, [prop]: keys } });
    setSel({ prop, i: keys.findIndex((k) => Math.abs(k.t - p) < 0.005) });
  };
  const record = async (format: "webm" | "gif") => {
    const ac = new AbortController();
    setRec({ p: 0, ac });
    try {
      clock.current.p = 0;
      setPlaying(true);
      const blob = await recordCanvas(canvas.current!, { seconds: anim.duration, format, fps: format === "gif" ? 20 : 30, onProgress: (x) => setRec((r) => (r ? { ...r, p: x } : r)), signal: ac.signal });
      downloadBlob(`animation.${format}`, blob);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "error");
    } finally {
      setRec(null);
    }
  };
  const props = Object.keys(anim.tracks) as Prop[];
  return (
    <div className="editor-split">
      <div className="col" style={{ gap: 8, minWidth: 0 }}>
        <canvas ref={canvas} width={720} height={360} style={{ width: "100%", borderRadius: 12, display: "block" }} aria-label={t("motion.preview")} />
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" aria-label={playing ? t("academy.pause") : t("academy.play")} onClick={() => setPlaying(!playing)}>{playing ? <I.IconPause size={16} /> : <I.IconPlay size={16} />}</button>
          <input type="range" min={0} max={1} step={0.001} value={p} onChange={(e) => (setPlaying(false), (clock.current.p = Number(e.target.value)), setP(Number(e.target.value)))} style={{ flex: 1 }} aria-label={t("motion.playhead")} />
          <span className="small mono" style={{ width: 64, textAlign: "right" }}>{(p * anim.duration).toFixed(2)} s</span>
        </div>
        <div className="card col" style={{ gap: 2, padding: 8 }}>
          {props.map((prop) => (
            <div key={prop} className="track-row">
              <span className="small mono" style={{ width: 64 }}>{prop}</span>
              <div className="track-lane" onDoubleClick={() => addKey(prop)}>
                <span className="track-playhead" style={{ left: `${p * 100}%` }} />
                {[...anim.tracks[prop]].sort((a, b) => a.t - b.t).map((k, i) => (
                  <button key={i} className={`track-key ${sel?.prop === prop && sel.i === i ? "active" : ""}`} style={{ left: `${k.t * 100}%` }} aria-label={`${prop} ${k.t.toFixed(2)}`} onClick={() => (setSel({ prop, i }), setPlaying(false), (clock.current.p = k.t), setP(k.t))} />
                ))}
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => addKey(prop)} title={t("motion.addKey")}>◆+</button>
            </div>
          ))}
          <span className="hint">{t("motion.timelineHint")}</span>
        </div>
      </div>
      <aside className="card col" style={{ gap: 10, alignSelf: "start" }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {(["box", "circle", "text", "emoji"] as const).map((s) => <button key={s} className={`btn btn-sm ${anim.shape === s ? "btn-primary" : ""}`} onClick={() => setAnim({ ...anim, shape: s, label: s === "emoji" ? "🚀" : s === "text" ? "Hi!" : anim.label })}>{t(`motion.shape.${s}`)}</button>)}
          <input type="color" value={anim.color} onChange={(e) => setAnim({ ...anim, color: e.target.value })} aria-label="Color" />
        </div>
        {(anim.shape === "text" || anim.shape === "emoji") && <input className="input input-sm" value={anim.label} onChange={(e) => setAnim({ ...anim, label: e.target.value })} aria-label={t("motion.label")} />}
        <label className="row small" style={{ gap: 6 }}>{t("motion.duration")} <input className="input input-sm" type="number" min={0.2} max={30} step={0.1} value={anim.duration} onChange={(e) => setAnim({ ...anim, duration: Math.max(0.2, Number(e.target.value)) })} style={{ width: 80 }} /> s
          <input type="checkbox" checked={anim.loop} onChange={(e) => setAnim({ ...anim, loop: e.target.checked })} /> {t("motion.loop")}</label>
        {sel && key && (
          <>
            <div className="section-label">◆ {sel.prop} · {(key.t * anim.duration).toFixed(2)} s</div>
            <label className="col small" style={{ gap: 2 }}>{t("motion.value")} {key.v}
              <input type="range" min={RANGE[sel.prop][0]} max={RANGE[sel.prop][1]} step={RANGE[sel.prop][2]} value={key.v} onChange={(e) => setKey({ v: Number(e.target.value) })} /></label>
            <label className="col small" style={{ gap: 2 }}>{t("motion.time")} {(key.t * 100).toFixed(0)}%
              <input type="range" min={0} max={1} step={0.005} value={key.t} onChange={(e) => setKey({ t: Number(e.target.value) })} /></label>
            <div className="small muted">{t("motion.easing")}</div>
            <BezierEditor value={key.ease} onChange={(ease) => setKey({ ease })} />
            <div className="row wrap" style={{ gap: 4 }}>{Object.entries(EASES).map(([k, e]) => <button key={k} className="chip" onClick={() => setKey({ ease: e })}>{k}</button>)}</div>
            <button className="btn btn-sm btn-ghost" disabled={anim.tracks[sel.prop].length <= 1} onClick={() => (setAnim({ ...anim, tracks: { ...anim.tracks, [sel.prop]: anim.tracks[sel.prop].filter((k) => k !== key) } }), setSel(null))}><I.IconTrash size={13} /> {t("motion.deleteKey")}</button>
          </>
        )}
        <div className="section-label">{t("media.export")}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => void copyText(toCss(anim), t("common.copied"))}>CSS</button>
          <button className="btn btn-sm" onClick={() => void copyText(toWaapi(anim), t("common.copied"))}>JS (WAAPI)</button>
          <button className="btn btn-sm" onClick={() => downloadText("animation.json", JSON.stringify(anim, null, 2), "application/json")}>JSON</button>
        </div>
        {canRecordWebm() && (rec ? (
          <button className="btn btn-sm btn-danger" onClick={() => rec.ac.abort()}>{Math.round(rec.p * 100)}% · {t("common.cancel")}</button>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void record("webm")}><I.IconFilm size={13} /> WebM</button>
            <button className="btn btn-sm" onClick={() => void record("gif")}><I.IconFilm size={13} /> GIF</button>
          </div>
        ))}
      </aside>
    </div>
  );
}

function LottiePlayer({ t }: { t: T }) {
  const host = useRef<HTMLDivElement>(null);
  const anim = useRef<import("lottie-web/build/player/lottie_light_canvas").AnimationItem | null>(null);
  const [data, setData] = useState<{ json: unknown; name: string } | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [frame, setFrame] = useState(0);
  const [total, setTotal] = useState(0);
  const [bg, setBg] = useState("#ffffff");
  const [rec, setRec] = useState<{ p: number; ac: AbortController } | null>(null);
  const builderOpen = useBuilder((s) => !!s.projectId);
  useEffect(() => {
    if (!data || !host.current) return;
    let alive = true;
    void import("lottie-web/build/player/lottie_light_canvas").then(({ default: lottie }) => {
      if (!alive || !host.current) return;
      anim.current?.destroy();
      host.current.innerHTML = "";
      const a = lottie.loadAnimation({ container: host.current, renderer: "canvas", loop: true, autoplay: true, animationData: structuredClone(data.json), rendererSettings: { clearCanvas: true } });
      anim.current = a;
      a.addEventListener("DOMLoaded", () => setTotal(Math.round(a.totalFrames)));
      a.addEventListener("enterFrame", () => setFrame(Math.round(a.currentFrame)));
    });
    return () => {
      alive = false;
      anim.current?.destroy();
      anim.current = null;
    };
  }, [data]);
  const open = async () => {
    const f = await pickFile(".json,application/json");
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!json.layers || !json.fr) throw new Error(t("motion.notLottie"));
      setData({ json, name: f.name });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const record = async (format: "webm" | "gif") => {
    const canvas = host.current?.querySelector("canvas");
    if (!canvas || !anim.current) return;
    const ac = new AbortController();
    setRec({ p: 0, ac });
    try {
      anim.current.goToAndPlay(0, true);
      const seconds = anim.current.totalFrames / (anim.current.frameRate * speed);
      const blob = await recordCanvas(canvas, { seconds, format, onProgress: (x) => setRec((r) => (r ? { ...r, p: x } : r)), signal: ac.signal });
      downloadBlob(`${data!.name.replace(/\.json$/, "")}.${format}`, blob);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "error");
    } finally {
      setRec(null);
    }
  };
  const saveAndInsert = async (insert: boolean) => {
    if (!data) return;
    const r = await mediaApi.upload({ name: data.name, mime: "application/json", data: toBase64(JSON.stringify(data.json)), tags: ["lottie"] });
    if (insert) {
      const src = `${location.origin}${r.url}`;
      useBuilder.getState().insert(n("html", { html: `<script src="https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js"></script>\n<lottie-player src="${src}" background="transparent" speed="1" style="width:100%;max-width:420px;margin:auto" loop autoplay></lottie-player>` }));
      toast(t("motion.lottieInserted"), "success");
    } else toast(t("media.savedAsset", { size: `${Math.round(JSON.stringify(data.json).length / 1024)} KB` }), "success");
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      {!data ? (
        <div className="empty"><p style={{ marginBottom: 12 }}>{t("motion.lottieHint")}</p><button className="btn btn-primary" onClick={() => void open()}><I.IconUpload size={14} /> {t("motion.openLottie")}</button></div>
      ) : (
        <>
          <div ref={host} className="lottie-stage" style={{ background: bg }} />
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="icon-btn" aria-label={playing ? t("academy.pause") : t("academy.play")} onClick={() => (playing ? anim.current?.pause() : anim.current?.play(), setPlaying(!playing))}>{playing ? <I.IconPause size={16} /> : <I.IconPlay size={16} />}</button>
            <input type="range" min={0} max={Math.max(1, total)} value={frame} onChange={(e) => (anim.current?.goToAndStop(Number(e.target.value), true), setPlaying(false))} style={{ flex: 1 }} aria-label={t("motion.playhead")} />
            <span className="small mono">{frame}/{total}</span>
            <select className="select input-sm" style={{ width: 80 }} value={speed} onChange={(e) => (setSpeed(Number(e.target.value)), anim.current?.setSpeed(Number(e.target.value)))} aria-label={t("academy.speed")}>{[0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background" />
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void open()}><I.IconUpload size={13} /> {t("motion.openLottie")}</button>
            <button className="btn btn-sm" onClick={() => void saveAndInsert(false)}><I.IconSave size={13} /> {t("media.saveToAssets")}</button>
            <button className="btn btn-sm" disabled={!builderOpen} onClick={() => void saveAndInsert(true)}><I.IconBuilder size={13} /> {t("motion.insertLottie")}</button>
            {canRecordWebm() && (rec ? <button className="btn btn-sm btn-danger" onClick={() => rec.ac.abort()}>{Math.round(rec.p * 100)}%</button> : (<><button className="btn btn-sm" onClick={() => void record("webm")}><I.IconFilm size={13} /> WebM</button><button className="btn btn-sm" onClick={() => void record("gif")}><I.IconFilm size={13} /> GIF</button></>))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MotionPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "presets" | "timeline" | "lottie") ?? "presets";
  const tabs: Array<[typeof tab, string]> = [["presets", t("motion.tab.presets")], ["timeline", t("motion.tab.timeline")], ["lottie", "Lottie"]];
  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setParams({ tab: id })}>{label}</button>)}
      </div>
      <div className="page">
        <div className="page-narrow" style={{ maxWidth: 1240 }}>
          {tab === "presets" && <Presets t={t} />}
          {tab === "timeline" && <Timeline t={t} />}
          {tab === "lottie" && <LottiePlayer t={t} />}
        </div>
      </div>
    </div>
  );
}
