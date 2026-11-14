/**
 * Record any <canvas> (3D viewport, Lottie, motion preview) to WebM (MediaRecorder) or GIF (gifenc),
 * entirely in the browser.
 */
export interface RecordOptions {
  seconds: number;
  fps?: number;
  format: "webm" | "gif";
  /** GIF only: longest side in px (GIFs get big fast). */
  maxSize?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** Called every frame before capture — drive your animation clock here if it isn't real-time. */
  onFrame?: (t: number) => void;
}

export const canRecordWebm = () => typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";

export async function recordCanvas(canvas: HTMLCanvasElement, o: RecordOptions): Promise<Blob> {
  const fps = o.fps ?? (o.format === "gif" ? 15 : 30);
  if (o.format === "webm") {
    const stream = canvas.captureStream(fps);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))));
    rec.start(500);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        o.onFrame?.(t);
        o.onProgress?.(Math.min(1, t / o.seconds));
        if (t >= o.seconds || o.signal?.aborted) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
    rec.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return done;
  }
  // GIF: sample frames through a video element (works for WebGL canvases without preserveDrawingBuffer).
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const max = o.maxSize ?? 480;
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const w = Math.max(2, Math.round(canvas.width * scale));
  const h = Math.max(2, Math.round(canvas.height * scale));
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = canvas.captureStream(fps);
  await video.play();
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const frames = Math.round(o.seconds * fps);
  const delay = Math.round(1000 / fps);
  for (let i = 0; i < frames; i++) {
    if (o.signal?.aborted) break;
    o.onFrame?.(i / fps);
    await new Promise((r) => setTimeout(r, delay));
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay });
    o.onProgress?.((i + 1) / frames);
  }
  (video.srcObject as MediaStream).getTracks().forEach((tr) => tr.stop());
  if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}
