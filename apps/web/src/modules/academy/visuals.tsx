import type { Visual } from "./course";

/** Animated explainer visuals. `step` advances with each key point so the picture evolves with the lesson. */
export function LessonVisual({ kind, step = 0 }: { kind: Visual; step?: number }) {
  switch (kind) {
    case "flex": {
      const modes = ["flex-start", "center", "space-between", "space-around", "space-evenly", "flex-end"];
      return (
        <div className="av av-flex" style={{ justifyContent: modes[step % modes.length] }}>
          {[0, 1, 2].map((i) => <span key={i} className="av-box" style={{ animationDelay: `${i * 0.12}s` }} />)}
          <code className="av-caption">justify-content: {modes[step % modes.length]}</code>
        </div>
      );
    }
    case "grid":
      return (
        <div className="av av-grid" style={{ gridTemplateColumns: step % 2 ? "1fr 2fr 1fr" : "repeat(3, 1fr)" }}>
          {Array.from({ length: 6 }, (_, i) => <span key={i} className="av-box" style={{ animationDelay: `${i * 0.08}s`, gridColumn: i === 0 && step % 3 === 2 ? "1 / -1" : undefined }} />)}
        </div>
      );
    case "devices":
      return (
        <div className="av av-devices">
          <span className="av-device desk"><i /><i /><i /></span>
          <span className="av-device tab"><i /><i /></span>
          <span className="av-device phone"><i /></span>
        </div>
      );
    case "promise":
      return (
        <div className="av av-promise">
          <span className="av-pill">fetch()</span>
          <span className="av-arrow" />
          <span className="av-pill pending">pending…</span>
          <span className="av-arrow" />
          <span className="av-pill ok">resolved ✓</span>
        </div>
      );
    case "loop":
      return (
        <div className="av av-loop">
          <div className="av-ring"><span className="av-dot" /></div>
          <div className="col av-queue">
            <span className="av-pill">call stack</span>
            <span className="av-pill pending">microtasks</span>
            <span className="av-pill">macrotasks</span>
          </div>
        </div>
      );
    case "request":
      return (
        <div className="av av-request">
          <span className="av-node">💻</span>
          <div className="av-wire"><span className="av-packet req">GET /products</span><span className="av-packet res">200 OK</span></div>
          <span className="av-node">🖥️</span>
        </div>
      );
    case "contrast":
      return (
        <div className="av av-contrast">
          <span className="av-swatch" style={{ background: "#fff", color: "#9aa1b2" }}>Aa 2.6:1 ✗</span>
          <span className="av-swatch" style={{ background: "#fff", color: "#14161f" }}>Aa 17:1 ✓</span>
          <span className="av-swatch" style={{ background: "#6d5efc", color: "#fff" }}>Aa 4.8:1 ✓</span>
        </div>
      );
    case "branches":
      return (
        <svg className="av av-svg" viewBox="0 0 300 120" aria-hidden="true">
          <path className="av-draw" d="M20 90 H280" />
          <path className="av-draw d2" d="M80 90 C110 90 110 40 140 40 H200 C230 40 230 90 260 90" />
          {[20, 80, 140, 200, 260].map((x, i) => <circle key={x} className="av-commit" cx={x} cy={i === 2 || i === 3 ? 40 : 90} r="7" style={{ animationDelay: `${i * 0.25}s` }} />)}
        </svg>
      );
    case "pipeline":
      return (
        <div className="av av-pipeline">
          {["build", "test", "deploy", "monitor"].map((s, i) => <span key={s} className="av-stage" style={{ animationDelay: `${i * 0.5}s` }}>{s}</span>)}
        </div>
      );
    case "cube":
      return (
        <div className="av av-cube-wrap">
          <div className="av-cube">{["front", "back", "right", "left", "top", "bottom"].map((f) => <span key={f} className={`face ${f}`} />)}</div>
        </div>
      );
    case "easing":
      return (
        <div className="av av-easing">
          {["linear", "ease-out", "cubic-bezier(.34,1.56,.64,1)"].map((e) => (
            <div key={e} className="av-track"><span className="av-ball" style={{ animationTimingFunction: e }} /><code>{e.length > 12 ? "overshoot" : e}</code></div>
          ))}
        </div>
      );
    case "tables":
      return (
        <svg className="av av-svg" viewBox="0 0 300 130" aria-hidden="true">
          <rect className="av-table" x="10" y="20" width="110" height="90" rx="8" />
          <rect className="av-table" x="180" y="20" width="110" height="90" rx="8" />
          <text x="22" y="42" className="av-text">users</text>
          <text x="192" y="42" className="av-text">orders</text>
          <text x="22" y="66" className="av-text dim">🔑 id</text>
          <text x="192" y="66" className="av-text dim">↗ user_id</text>
          <path className="av-draw" d="M120 62 C150 62 150 62 180 62" />
        </svg>
      );
    case "shield":
      return (
        <div className="av av-shield">
          <span className="av-shield-icon">🛡️</span>
          <span className="av-attack a1">&lt;script&gt;</span>
          <span className="av-attack a2">' OR 1=1</span>
          <span className="av-attack a3">169.254…</span>
        </div>
      );
    case "tree":
      return (
        <svg className="av av-svg" viewBox="0 0 300 130" aria-hidden="true">
          <path className="av-draw" d="M150 25 L80 75 M150 25 L220 75 M80 75 L50 115 M80 75 L110 115" />
          {[[150, 25], [80, 75], [220, 75], [50, 115], [110, 115]].map(([x, y], i) => <circle key={i} className="av-commit" cx={x} cy={y} r="11" style={{ animationDelay: `${i * 0.2}s` }} />)}
        </svg>
      );
    case "palette":
      return (
        <div className="av av-contrast">
          {["#6d5efc", "#0ea5e9", "#22c55e", "#f59e0b", "#ec4899"].map((c, i) => <span key={c} className="av-swatch small" style={{ background: c, animationDelay: `${i * 0.1}s` }} />)}
        </div>
      );
    case "keys":
      return (
        <div className="av av-keys">
          {["Ctrl", "K"].map((k, i) => <kbd key={k} className="av-key" style={{ animationDelay: `${i * 0.3}s` }}>{k}</kbd>)}
        </div>
      );
    default:
      return (
        <div className="av av-bullets">
          {[0, 1, 2].map((i) => <span key={i} className="av-line" style={{ animationDelay: `${i * 0.2}s`, width: `${90 - i * 18}%` }} />)}
        </div>
      );
  }
}
