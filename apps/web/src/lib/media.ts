import { useSyncExternalStore } from "react";

/** Subscribe to a CSS media query. Works on every device and updates on rotate / resize. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones and portrait tablets: panels become tabs, the sidebar becomes a drawer. */
export const COMPACT = "(max-width: 900px)";
export const useCompact = () => useMedia(COMPACT);
/** Touch-first devices (fingers instead of a mouse). */
export const useCoarse = () => useMedia("(pointer: coarse)");
export const isCompact = () => typeof window !== "undefined" && window.matchMedia(COMPACT).matches;
