import { useSyncExternalStore } from "react";
import { FunctionRegistry, type PanelFunction } from "@mfc/core";
import { useUi } from "./ui";

/** Context passed to every panel function. */
export interface AppCtx {
  navigate: (path: string) => void;
  module: string;
}

let navigateImpl: (path: string) => void = (p) => {
  window.history.pushState({}, "", p);
};
export function setNavigate(fn: (path: string) => void) {
  navigateImpl = fn;
}

export const registry = new FunctionRegistry<AppCtx>();
export type AppFunction = PanelFunction<AppCtx>;

export function getCtx(): AppCtx {
  return { navigate: (p) => navigateImpl(p), module: useUi.getState().module };
}

export function runFunction(id: string, args: Record<string, unknown> = {}) {
  return registry.run(id, args, getCtx());
}

export function useRegistryVersion() {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.rev,
  );
}

/** Normalize a key event to a shortcut string like "mod+shift+z". */
export function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  if (key === "escape") key = "esc";
  if (!["control", "meta", "alt", "shift"].includes(key)) parts.push(key);
  return parts.join("+");
}

export function prettyShortcut(s: string): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return s
    .split("+")
    .map((p) => (p === "mod" ? (mac ? "⌘" : "Ctrl") : p === "shift" ? "⇧" : p === "alt" ? (mac ? "⌥" : "Alt") : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(mac ? "" : "+");
}
