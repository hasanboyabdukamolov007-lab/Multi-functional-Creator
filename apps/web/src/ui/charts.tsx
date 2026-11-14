import { useRef, useState } from "react";

/**
 * Small, accessible chart kit. Series colors come from the validated categorical pair (.viz-root vars);
 * status colors (good / needs work / poor) always ship with an icon and a text label.
 */

export function LineChart({ points, label, format = (v) => String(v), height = 200 }: { points: Array<{ t: string; v: number }>; label: string; format?: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = height;
  const P = { l: 44, r: 16, t: 12, b: 26 };
  if (!points.length) return <div className="empty" style={{ padding: 24 }}>—</div>;
  const max = Math.max(1, ...points.map((p) => p.v));
  const nice = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 10 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 5 : 2);
  const x = (i: number) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i / (points.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - v / nice) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  return (
    <div className="viz-root" style={{ position: "relative" }}>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${label}: ${points.map((p) => `${p.t} ${format(p.v)}`).join(", ")}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onPointerMove={(e) => {
          const r = svg.current!.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (points.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(nice * f)} y2={y(nice * f)} className="viz-grid" />
            <text x={P.l - 6} y={y(nice * f) + 4} textAnchor="end" className="viz-axis">{format(Math.round(nice * f))}</text>
          </g>
        ))}
        <text x={P.l} y={H - 6} className="viz-axis">{points[0].t}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="viz-axis">{points[points.length - 1].t}</text>
        <path d={area} className="viz-s1" style={{ fill: "var(--c)", opacity: 0.12 }} />
        <path d={d} className="viz-line viz-s1" fill="none" />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="viz-crosshair" />
            <circle cx={x(hover)} cy={y(points[hover].v)} r={4.5} className="viz-dot viz-s1" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="small muted">{points[hover].t}</div>
          <strong>{format(points[hover].v)}</strong> <span className="small muted">{label}</span>
        </div>
      )}
    </div>
  );
}

export function BarList({ items, total, empty = "—" }: { items: Array<{ key: string; count: number }>; total?: number; empty?: string }) {
  if (!items.length) return <div className="hint">{empty}</div>;
  const max = Math.max(...items.map((i) => i.count));
  const sum = total ?? items.reduce((a, b) => a + b.count, 0);
  return (
    <div className="viz-root col" style={{ gap: 4 }}>
      {items.map((i) => (
        <div key={i.key} className="barlist-row" title={`${i.key}: ${i.count}`}>
          <span className="barlist-fill viz-s1" style={{ width: `${(i.count / max) * 100}%` }} />
          <span className="barlist-label ellipsis">{i.key}</span>
          <span className="barlist-value">{i.count.toLocaleString()}<span className="muted"> · {Math.round((i.count / Math.max(1, sum)) * 100)}%</span></span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 28, label }: { values: Array<number | null>; width?: number; height?: number; label: string }) {
  const v = values.map((x) => (x === null ? NaN : x));
  const finite = v.filter((x) => Number.isFinite(x));
  if (finite.length < 2) return <span className="small muted">—</span>;
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  const pts = v.map((val, i) => (Number.isFinite(val) ? `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((val - min) / Math.max(1, max - min)) * (height - 4)).toFixed(1)}` : null)).filter(Boolean);
  return (
    <svg className="viz-root" width={width} height={height} role="img" aria-label={label} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" className="viz-line viz-s1" style={{ strokeWidth: 1.5 }} />
    </svg>
  );
}

export type Health = "good" | "warn" | "bad" | "none";
export const HEALTH_ICON: Record<Health, string> = { good: "✓", warn: "!", bad: "✕", none: "·" };

/** One bar per day, colored by uptime, with an icon-free legend handled by the caller. */
export function UptimeBars({ days, count = 90, labels }: { days: Array<{ day: string; uptime: number }>; count?: number; labels: { good: string; warn: string; bad: string; none: string } }) {
  const byDay = new Map(days.map((d) => [d.day, d.uptime]));
  const out: Array<{ day: string; u: number | null }> = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, u: byDay.has(d) ? byDay.get(d)! : null });
  }
  const health = (u: number | null): Health => (u === null ? "none" : u >= 0.995 ? "good" : u >= 0.95 ? "warn" : "bad");
  return (
    <div className="uptime-bars" role="img" aria-label={`${labels.good}: ${out.filter((o) => health(o.u) === "good").length}, ${labels.warn}: ${out.filter((o) => health(o.u) === "warn").length}, ${labels.bad}: ${out.filter((o) => health(o.u) === "bad").length}`}>
      {out.map((o) => (
        <span key={o.day} className={`uptime-bar h-${health(o.u)}`} title={`${o.day} · ${o.u === null ? labels.none : `${(o.u * 100).toFixed(2)}% · ${labels[health(o.u) as "good"]}`}`} />
      ))}
    </div>
  );
}

export function HealthBadge({ health, label }: { health: Health; label: string }) {
  return (
    <span className={`health-badge h-${health}`}>
      <span aria-hidden="true">{HEALTH_ICON[health]}</span> {label}
    </span>
  );
}

/** Core Web Vitals thresholds (p75) from web.dev. */
export const VITAL_THRESHOLDS: Record<string, [number, number, string]> = {
  LCP: [2500, 4000, "ms"],
  INP: [200, 500, "ms"],
  CLS: [0.1, 0.25, ""],
  FCP: [1800, 3000, "ms"],
  TTFB: [800, 1800, "ms"],
};
export const vitalHealth = (name: string, v: number): Health => {
  const t = VITAL_THRESHOLDS[name];
  if (!t) return "none";
  return v <= t[0] ? "good" : v <= t[1] ? "warn" : "bad";
};
export const formatVital = (name: string, v: number) => (name === "CLS" ? v.toFixed(3) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
