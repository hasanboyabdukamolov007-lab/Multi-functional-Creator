import { useMemo } from "react";
import { create } from "zustand";
import { prettyShortcut, registry, useRegistryVersion } from "../lib/registry";
import { useT } from "../lib/i18n";
import { functionTitle } from "./CommandPalette";
import { IconClose } from "../ui/icons";

export const useShortcutsHelp = create<{ open: boolean; set: (v: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export function ShortcutsHelp() {
  const t = useT();
  const { open, set } = useShortcutsHelp();
  const rev = useRegistryVersion();
  const groups = useMemo(() => {
    const m = new Map<string, Array<{ title: string; shortcut: string }>>();
    for (const f of registry.list()) if (f.shortcut) m.set(f.category.split(" · ")[0], [...(m.get(f.category.split(" · ")[0]) ?? []), { title: functionTitle(f), shortcut: f.shortcut }]);
    return [...m.entries()];
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && set(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("shell.shortcuts")} style={{ width: "min(760px, calc(100vw - 32px))" }}>
        <div className="row">
          <div className="modal-title grow">{t("shell.shortcuts")}</div>
          <button className="icon-btn" onClick={() => set(false)} aria-label={t("common.close")}><IconClose size={16} /></button>
        </div>
        <div style={{ columns: "2 300px", columnGap: 24, marginTop: 12 }}>
          {groups.map(([g, items]) => (
            <div key={g} style={{ breakInside: "avoid", marginBottom: 14 }}>
              <div className="section-label">{g}</div>
              {items.map((i) => (
                <div key={i.title + i.shortcut} className="row small" style={{ justifyContent: "space-between", padding: "3px 0" }}>
                  <span>{i.title}</span>
                  <kbd>{prettyShortcut(i.shortcut)}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
