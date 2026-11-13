import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "./store";
import { keyTimes } from "./animation";
import { EASINGS, type Easing } from "./model";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

export function Timeline() {
  const t = useT();
  const { time, playing, duration, autoKey, defaultEasing, selectedId, tracks, objects } = useStudio(
    useShallow((s) => ({ time: s.time, playing: s.playing, duration: s.doc.settings.duration, autoKey: s.autoKey, defaultEasing: s.defaultEasing, selectedId: s.selectedId, tracks: s.doc.tracks, objects: s.doc.objects })),
  );
  const st = useStudio.getState();
  const ruler = useRef<HTMLDivElement>(null);
  const animated = useMemo(() => objects.filter((o) => tracks.some((tr) => tr.objectId === o.id) || o.id === selectedId), [objects, tracks, selectedId]);
  const ticks = Math.min(20, Math.ceil(duration));

  const timeFromEvent = (clientX: number) => {
    const r = ruler.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const scrub = (e: React.PointerEvent) => {
    st.setPlaying(false);
    st.setTime(timeFromEvent(e.clientX));
    const move = (ev: PointerEvent) => st.setTime(timeFromEvent(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const atKey = selectedId ? keyTimes(tracks, selectedId).some((k) => Math.abs(k - time) < 1 / 60) : false;

  return (
    <div className="panel" style={{ borderTop: "1px solid var(--mfc-border)" }}>
      <div className="toolbar" style={{ height: 40 }}>
        <button className="icon-btn" title="Play / pause (Space)" onClick={() => st.setPlaying(!playing)}>{playing ? <I.IconPause size={16} /> : <I.IconPlay size={16} />}</button>
        <button className="icon-btn" title="Stop" onClick={() => (st.setPlaying(false), st.setTime(0))}><I.IconStop size={14} /></button>
        <span className="mono small" style={{ width: 92 }}>{time.toFixed(2)}s / {duration.toFixed(1)}s</span>
        <div className="toolbar-sep" />
        <button className={`btn btn-sm ${atKey ? "btn-primary" : ""}`} disabled={!selectedId} onClick={() => selectedId && st.keyObject(selectedId)} title="Insert keyframe (K)">◆ {t("studio.keyframe")}</button>
        <button className="btn btn-sm btn-ghost" disabled={!selectedId || !atKey} onClick={() => selectedId && st.deleteKeyAt(selectedId, time)}>Delete key</button>
        <select className="select input-sm" style={{ width: 120 }} value={defaultEasing} onChange={(e) => { st.setDefaultEasing(e.target.value as Easing); if (selectedId && atKey) st.setEasingAt(selectedId, time, e.target.value as Easing); }} title="Easing for new keys (and the key under the playhead)">
          {EASINGS.map((e) => (<option key={e} value={e}>{e}</option>))}
        </select>
        <label className="row small" style={{ gap: 4 }}>
          <input type="checkbox" checked={autoKey} onChange={(e) => st.setAutoKey(e.target.checked)} /> {t("studio.autoKey")}
        </label>
        <div className="grow" />
        <span className="small muted">{t("studio.timeline")}</span>
      </div>
      <div className="panel-body" style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignContent: "start" }}>
        <div />
        <div ref={ruler} onPointerDown={scrub} style={{ position: "relative", height: 22, borderBottom: "1px solid var(--mfc-border)", cursor: "ew-resize", margin: "0 12px" }}>
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <span key={i} className="small muted" style={{ position: "absolute", left: `${(i / ticks) * 100}%`, transform: "translateX(-50%)", top: 2, fontSize: 10 }}>{((i / ticks) * duration).toFixed(ticks > 10 ? 0 : 1)}</span>
          ))}
          <div style={{ position: "absolute", left: `${(time / duration) * 100}%`, top: 0, bottom: -400, width: 2, background: "var(--mfc-accent)", pointerEvents: "none", zIndex: 2 }} />
        </div>
        {animated.map((o) => {
          const times = keyTimes(tracks, o.id);
          return (
            <div key={o.id} style={{ display: "contents" }}>
              <div className={`list-item ${o.id === selectedId ? "selected" : ""}`} style={{ borderRadius: 0, height: 26 }} onClick={() => st.select(o.id)}>
                <span className="ellipsis small">{o.name}</span>
              </div>
              <div style={{ position: "relative", height: 26, margin: "0 12px", borderBottom: "1px solid color-mix(in srgb, var(--mfc-border) 50%, transparent)" }}>
                {times.map((k) => (
                  <button key={k} title={`${k.toFixed(2)}s`} onClick={() => (st.select(o.id), st.setPlaying(false), st.setTime(k))}
                    style={{ position: "absolute", left: `${(k / duration) * 100}%`, top: 7, width: 11, height: 11, transform: "translateX(-50%) rotate(45deg)", background: o.id === selectedId ? "var(--mfc-accent)" : "var(--mfc-muted)", border: "1px solid var(--mfc-bg)", padding: 0, cursor: "pointer" }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
