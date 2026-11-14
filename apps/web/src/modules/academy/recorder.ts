/**
 * Renders a lesson to a WebM video entirely in the browser: a canvas animation of every scene
 * (title, concept, key points, code typing, pitfalls, quiz, outro) with burned-in captions,
 * captured with MediaRecorder. No server, no uploads.
 */
import type { Lesson, Scene, Visual } from "./course";

const W = 1280;
const H = 720;
const FPS = 30;

export const canRecord = () => typeof window !== "undefined" && "MediaRecorder" in window && typeof HTMLCanvasElement.prototype.captureStream === "function";

const dur = (s: Scene) => (s.kind === "code" ? Math.min(12, 4 + s.code.length / 50) : s.kind === "quiz" ? 7 : Math.max(3.5, s.say.split(/\s+/).length * 0.4 + 1.2));
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

function background(ctx: CanvasRenderingContext2D, t: number) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0f1220");
  g.addColorStop(1, "#171a2b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(200 + Math.sin(t / 3) * 60, -40, 10, 200, 0, 700);
  r.addColorStop(0, "rgba(109,94,252,0.45)");
  r.addColorStop(1, "rgba(109,94,252,0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
}

function visual(ctx: CanvasRenderingContext2D, kind: Visual, t: number, step: number, cy: number) {
  ctx.save();
  const grad = (x: number, y: number, s: number) => {
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, "#6d5efc");
    g.addColorStop(1, "#c64fd8");
    return g;
  };
  const box = (x: number, y: number, s: number, k: number) => {
    const p = ease(t * 2 - k * 0.15);
    ctx.globalAlpha = p;
    ctx.fillStyle = grad(x, y, s);
    ctx.beginPath();
    ctx.roundRect(x + (s * (1 - p)) / 2, y + (s * (1 - p)) / 2, s * p, s * p, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  if (kind === "flex" || kind === "grid" || kind === "bullets" || kind === "devices" || kind === "palette") {
    const n = kind === "grid" ? 6 : 3;
    const s = 64;
    const gap = kind === "flex" ? 40 + (step % 3) * 60 : 18;
    const cols = kind === "grid" ? 3 : n;
    const totalW = cols * s + (cols - 1) * gap;
    for (let k = 0; k < n; k++) box(W / 2 - totalW / 2 + (k % cols) * (s + gap), cy - 40 + Math.floor(k / cols) * (s + 14), s, k);
  } else if (kind === "loop" || kind === "cube" || kind === "easing") {
    ctx.translate(W / 2, cy);
    ctx.rotate(t * 1.6);
    ctx.strokeStyle = "#6d5efc";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f2a93b";
    ctx.beginPath();
    ctx.arc(0, -60, 9, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // request / pipeline / branches / tables / shield / tree / keys / contrast / promise: flowing stages.
    const labels: Record<string, string[]> = { request: ["client", "→ GET", "server"], pipeline: ["build", "test", "deploy", "monitor"], branches: ["main", "feature", "merge"], tables: ["users", "⟷", "orders"], shield: ["input", "🛡", "safe"], tree: ["App", "Page", "Button"], keys: ["Ctrl", "K"], contrast: ["Aa ✗", "Aa ✓", "Aa ✓"], promise: ["fetch()", "pending", "resolved ✓"] };
    const ls = labels[kind] ?? ["1", "2", "3"];
    ctx.font = "600 24px ui-monospace, Menlo, monospace";
    const widths = ls.map((l) => ctx.measureText(l).width + 36);
    const total = widths.reduce((a, b) => a + b, 0) + (ls.length - 1) * 24;
    let x = W / 2 - total / 2;
    ls.forEach((l, k) => {
      const active = Math.floor((t * 1.2) % ls.length) === k;
      ctx.globalAlpha = ease(t * 2 - k * 0.2);
      ctx.fillStyle = active ? "rgba(109,94,252,0.55)" : "rgba(255,255,255,0.08)";
      ctx.strokeStyle = active ? "#c7c2ff" : "#4b5272";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, cy - 26, widths[k], 52, 26);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#eef0f6";
      ctx.fillText(l, x + 18, cy + 8);
      x += widths[k] + 24;
    });
  }
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, s: Scene, t: number, d: number, title: string) {
  background(ctx, t);
  ctx.textAlign = "center";
  const p = t / d;
  const kicker = (txt: string, y = 150) => {
    ctx.font = "600 20px system-ui, sans-serif";
    ctx.fillStyle = "#a9b0ff";
    ctx.globalAlpha = ease(p * 4);
    ctx.fillText(txt.toUpperCase(), W / 2, y);
    ctx.globalAlpha = 1;
  };
  const words = (txt: string, y: number, size = 34, maxW = 980) => {
    ctx.font = `500 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = "#eef0f6";
    const lines = wrap(ctx, txt, maxW);
    const total = txt.split(/\s+/).length;
    let shown = Math.ceil(total * ease(p * 1.6));
    lines.forEach((ln, i) => {
      const ws = ln.split(" ");
      const part = ws.slice(0, Math.max(0, shown)).join(" ");
      shown -= ws.length;
      ctx.fillText(part, W / 2, y + i * size * 1.4);
    });
  };
  switch (s.kind) {
    case "title":
      kicker(s.subtitle, 280);
      ctx.font = "800 64px system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = ease(p * 3);
      wrap(ctx, s.title, 1100).forEach((l, i) => ctx.fillText(l, W / 2, 370 + i * 74));
      ctx.globalAlpha = 1;
      break;
    case "concept":
      visual(ctx, s.visual, t, 0, 220);
      words(s.text, 380);
      break;
    case "point":
      kicker(`${s.index} / ${s.total}`, 110);
      visual(ctx, s.visual, t, s.index, 230);
      words(s.text, 390);
      break;
    case "code": {
      kicker(s.lang, 90);
      ctx.textAlign = "left";
      ctx.fillStyle = "#0a0c14";
      ctx.beginPath();
      ctx.roundRect(140, 120, 1000, 500, 16);
      ctx.fill();
      ctx.font = "20px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#d8dcf0";
      const shown = s.code.slice(0, Math.floor(s.code.length * Math.min(1, p * 1.3)));
      shown.split("\n").slice(0, 18).forEach((l, i) => ctx.fillText(l.slice(0, 80), 170, 165 + i * 26));
      break;
    }
    case "pitfalls":
      kicker("⚠ pitfalls", 160);
      s.items.slice(0, 4).forEach((it, i) => {
        ctx.globalAlpha = ease(p * 3 - i * 0.4);
        ctx.font = "500 30px system-ui, sans-serif";
        ctx.fillStyle = "#ffb4ba";
        ctx.fillText(`✗ ${it}`.slice(0, 70), W / 2, 260 + i * 70);
      });
      ctx.globalAlpha = 1;
      break;
    case "quiz":
      kicker("✎ quick check", 120);
      words(s.q.q, 200, 32);
      s.q.options.forEach((o, i) => {
        const reveal = p > 0.65;
        const right = i === s.q.answer;
        ctx.fillStyle = reveal && right ? "rgba(47,191,113,0.25)" : "rgba(255,255,255,0.06)";
        ctx.strokeStyle = reveal && right ? "#2fbf71" : "#39405c";
        ctx.beginPath();
        ctx.roundRect(W / 2 - 360, 300 + i * 70, 720, 54, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#eef0f6";
        ctx.font = "500 24px system-ui, sans-serif";
        ctx.fillText(`${String.fromCharCode(65 + i)}. ${o}`.slice(0, 60), W / 2, 335 + i * 70);
      });
      break;
    case "try":
      kicker("▶ try it in the panel", 300);
      ctx.font = "700 40px system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.label, W / 2, 380);
      break;
    case "outro":
      ctx.font = "90px system-ui";
      ctx.fillText("🎉", W / 2, 300);
      ctx.font = "800 48px system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.title, W / 2, 400);
      if (s.next) {
        ctx.font = "500 28px system-ui, sans-serif";
        ctx.fillStyle = "#c7c2ff";
        ctx.fillText(`→ ${s.next}`, W / 2, 460);
      }
      break;
  }
  // Burned-in captions + lesson bug.
  if (s.kind !== "code" && s.kind !== "quiz") {
    ctx.font = "500 24px system-ui, sans-serif";
    const lines = wrap(ctx, s.say, 1040).slice(0, 2);
    const h = lines.length * 32 + 20;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - 540, H - 40 - h, 1080, h, 10);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H - 40 - h + 34 + i * 32));
  }
  ctx.textAlign = "left";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(`Multi-functional Creator · Academy · ${title}`, 24, 34);
}

/** Record the whole lesson. Resolves with a WebM blob. `signal` cancels. */
export async function recordLesson(lesson: Lesson, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(FPS);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))));
  const total = lesson.scenes.reduce((a, s) => a + dur(s), 0);
  rec.start(1000);
  let elapsed = 0;
  for (const s of lesson.scenes) {
    const d = dur(s);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const t = (performance.now() - start) / 1000;
        if (signal?.aborted || t >= d) return resolve();
        drawScene(ctx, s, t, d, lesson.title);
        onProgress((elapsed + t) / total);
        requestAnimationFrame(frame);
      };
      frame();
    });
    elapsed += d;
    if (signal?.aborted) break;
  }
  rec.stop();
  stream.getTracks().forEach((tr) => tr.stop());
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return done;
}
