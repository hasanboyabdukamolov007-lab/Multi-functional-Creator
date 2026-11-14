import { useMemo, useRef, useState } from "react";
import type { Metric } from "../copilot/brain/memory";

/**
 * Accuracy over training rounds — two series on one 0–100 % axis, smoothed with a rolling mean.
 * Validated categorical pair (blue / orange) in both schemes; legend + direct end labels; crosshair tooltip.
 */
const W = 640;
const H = 220;
const PAD = { l: 40, r: 70, t: 14, b: 26 };

function rolling(xs: number[], k = 8) {
  return xs.map((_, i) => {
    const s = xs.slice(Math.max(0, i - k + 1), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
}

export function LearningChart({ metrics, labels }: { metrics: Metric[]; labels: { fn: string; kb: string; round: string; empty: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const series = useMemo(() => {
    const fn = rolling(metrics.map((m) => m.fnAcc * 100));
    const kb = rolling(metrics.map((m) => m.kbAcc * 100));
    return [
      { key: "fn", name: labels.fn, cls: "viz-s1", values: fn },
      { key: "kb", name: labels.kb, cls: "viz-s2", values: kb },
    ];
  }, [metrics, labels.fn, labels.kb]);
  if (metrics.length < 2) return <div className="empty">{labels.empty}</div>;
  const n = metrics.length;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
  };
  return (
    <div className="viz-root col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        {series.map((s) => (
          <span key={s.key} className="row small" style={{ gap: 6 }}>
            <span className={`viz-key ${s.cls}`} aria-hidden="true" /> {s.name}
          </span>
        ))}
        <div className="grow" />
        <button className="btn btn-sm btn-ghost" onClick={() => setTable(!table)} aria-pressed={table}>{table ? "Chart" : "Table"}</button>
      </div>
      {table ? (
        <div style={{ maxHeight: 240, overflow: "auto" }}>
          <table className="table small">
            <thead><tr><th>{labels.round}</th><th>{labels.fn}</th><th>{labels.kb}</th></tr></thead>
            <tbody>{metrics.map((m, i) => <tr key={i}><td>{i + 1}</td><td>{Math.round(series[0].values[i])}%</td><td>{Math.round(series[1].values[i])}%</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${labels.fn} ${Math.round(series[0].values[n - 1])}%, ${labels.kb} ${Math.round(series[1].values[n - 1])}%`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y", display: "block" }}>
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="viz-grid" />
                <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="viz-axis">{v}%</text>
              </g>
            ))}
            <text x={PAD.l} y={H - 6} className="viz-axis">1</text>
            <text x={W - PAD.r} y={H - 6} textAnchor="end" className="viz-axis">{labels.round} {n}</text>
            {(() => {
              // End labels: keep at least 14px apart so close lines stay readable.
              const ys = series.map((s) => y(s.values[n - 1]));
              if (Math.abs(ys[0] - ys[1]) < 14) {
                const mid = (ys[0] + ys[1]) / 2;
                const up = ys[0] <= ys[1] ? 0 : 1;
                ys[up] = mid - 7;
                ys[1 - up] = mid + 7;
              }
              return series.map((s, i) => (
                <g key={s.key}>
                  <path d={path(s.values)} className={`viz-line ${s.cls}`} fill="none" />
                  <text x={x(n - 1) + 8} y={ys[i] + 4} className="viz-label">{Math.round(s.values[n - 1])}%</text>
                </g>
              ));
            })()}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="viz-crosshair" />
                {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4.5} className={`viz-dot ${s.cls}`} />)}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="viz-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <div className="small muted">{labels.round} {hover + 1} · {new Date(metrics[hover].at).toLocaleTimeString()}</div>
              {series.map((s) => (
                <div key={s.key} className="row small" style={{ gap: 6 }}>
                  <span className={`viz-key ${s.cls}`} aria-hidden="true" /> {s.name}: <strong>{Math.round(s.values[hover])}%</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
