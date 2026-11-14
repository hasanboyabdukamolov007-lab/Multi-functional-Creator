import { create } from "zustand";

/** Network status + "unsaved changes" registry used by the shell. */
export const useNet = create<{ online: boolean }>(() => ({ online: typeof navigator === "undefined" ? true : navigator.onLine }));
if (typeof window !== "undefined") {
  window.addEventListener("online", () => useNet.setState({ online: true }));
  window.addEventListener("offline", () => useNet.setState({ online: false }));
}

const dirty = new Map<string, () => boolean>();
/** Editors register a check; closing the tab while any reports unsaved work asks the user first. */
export function trackUnsaved(key: string, isDirty: () => boolean): () => void {
  dirty.set(key, isDirty);
  return () => void dirty.delete(key);
}
export const hasUnsaved = () => [...dirty.values()].some((f) => {
  try {
    return f();
  } catch {
    return false;
  }
});
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsaved()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
