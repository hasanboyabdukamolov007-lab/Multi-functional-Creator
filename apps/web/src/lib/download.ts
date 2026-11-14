import { isMobileShell, saveViaNative } from "./native";

export function downloadText(filename: string, content: string, type = "text/plain") {
  downloadBlob(filename, new Blob([content], { type: `${type};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob) {
  // Inside the mobile app a WebView can't save blob: URLs, so the native side saves / shares the file.
  if (isMobileShell()) {
    void saveViaNative(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

export const uid = (prefix = "n") => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
