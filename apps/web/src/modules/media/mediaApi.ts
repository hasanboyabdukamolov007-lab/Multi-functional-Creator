import { api } from "../../lib/api";
import { ws } from "../../lib/session";
import { toBase64 } from "../deploy/deployApi";

export interface Asset {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  folder: string;
  tags: string[];
  created_at: string;
  url: string;
}

export const mediaApi = {
  list: (opts: { q?: string; kind?: string } = {}) => api.get<{ assets: Asset[]; used: number; quota: number }>(ws(`/assets?${new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as Array<[string, string]>)}`)),
  upload: (b: { name: string; mime: string; data: string; width?: number | null; height?: number | null; folder?: string; tags?: string[] }) => api.post<{ id: string; url: string; deduplicated?: boolean }>(ws("/assets"), b),
  update: (id: string, b: { name?: string; folder?: string; tags?: string[] }) => api.patch(ws(`/assets/${id}`), b),
  remove: (id: string) => api.del(ws(`/assets/${id}`)),
  brand: () => api.get<{ brand: BrandKit | null }>(ws("/brand")).then((r) => r.brand),
  saveBrand: (brand: BrandKit) => api.put(ws("/brand"), { brand }),
};

export interface BrandKit {
  name: string;
  tagline: string;
  logoId: string | null;
  logoUrl: string | null;
  colors: Array<{ name: string; value: string }>;
  fonts: { heading: string; body: string };
  radius: string;
  voice: string;
}

const RASTER = /^image\/(png|jpeg|webp|avif)$/;

/** Read an image file, scale it to fit `max` px and re-encode as WebP when that's smaller. */
export async function optimizeImage(file: Blob, max = 2560, quality = 0.82): Promise<{ blob: Blob; width: number; height: number; mime: string; saved: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const webp = await canvas.convertToBlob({ type: "image/webp", quality });
  const better = webp.size < file.size || scale < 1;
  return { blob: better ? webp : file, width: w, height: h, mime: better ? "image/webp" : file.type, saved: better ? file.size - webp.size : 0 };
}

const EXT_MIME: Record<string, string> = { glb: "model/gltf-binary", gltf: "model/gltf+json", obj: "model/obj", stl: "model/stl", json: "application/json", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", pdf: "application/pdf", txt: "text/plain", svg: "image/svg+xml" };

/** Upload any file; images are optimised on the device first. */
export async function uploadFile(file: File, opts: { optimize?: boolean; folder?: string; tags?: string[] } = {}): Promise<{ id: string; url: string; saved: number }> {
  let blob: Blob = file;
  let mime = file.type || EXT_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
  let width: number | null = null;
  let height: number | null = null;
  let saved = 0;
  let name = file.name;
  if (RASTER.test(mime) && opts.optimize !== false) {
    const o = await optimizeImage(file);
    blob = o.blob;
    mime = o.mime;
    width = o.width;
    height = o.height;
    saved = o.saved;
    if (mime === "image/webp") name = name.replace(/\.(png|jpe?g|avif)$/i, ".webp");
  }
  const r = await mediaApi.upload({ name, mime, data: toBase64(new Uint8Array(await blob.arrayBuffer())), width, height, folder: opts.folder ?? "", tags: opts.tags ?? [] });
  return { ...r, saved };
}

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
