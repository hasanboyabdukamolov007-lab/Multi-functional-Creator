import { Command } from "cmdk";
import { useMemo, useState } from "react";
import { getCtx, prettyShortcut, registry, runFunction, useRegistryVersion } from "../lib/registry";
import { useUi, toast } from "../lib/ui";
import { t as tt, useT } from "../lib/i18n";
import { load, save } from "../lib/storage";

const RECENT_KEY = "mfc.palette.recent";
function remember(id: string) {
  save(RECENT_KEY, [id, ...load<string[]>(RECENT_KEY, []).filter((x) => x !== id)].slice(0, 8));
}
import { IconCommand } from "../ui/icons";

export function functionTitle(f: { title: string; titleKey?: string; titleArgs?: Record<string, string> }) {
  if (!f.titleKey) return f.title;
  const args = f.titleArgs ? Object.fromEntries(Object.entries(f.titleArgs).map(([k, v]) => [k, tt(v)])) : undefined;
  return tt(f.titleKey, args);
}

export function CommandPalette() {
  const t = useT();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const [query, setQuery] = useState("");
  useRegistryVersion();

  const results = useMemo(() => (open ? registry.search(query, 80) : []), [open, query]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof results>();
    if (!query.trim()) {
      const recent = load<string[]>(RECENT_KEY, []).map((id) => registry.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
      if (recent.length) m.set(tt("shell.recent"), recent);
    }
    for (const f of results) if (!m.get(tt("shell.recent"))?.includes(f)) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return [...m.entries()];
  }, [results, query]);

  if (!open) return null;
  const ctx = getCtx();
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Command className="palette" shouldFilter={false} label="Command palette" onKeyDown={(e) => e.key === "Escape" && close()}>
        <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={t("shell.palette")} />
        <Command.List>
          <Command.Empty>{t("shell.noResults")}</Command.Empty>
          {groups.map(([cat, fns]) => (
            <Command.Group key={cat} heading={cat}>
              {fns.map((f) => {
                const enabled = registry.isEnabled(f.id, ctx);
                return (
                  <Command.Item
                    key={f.id}
                    value={f.id}
                    disabled={enabled !== true}
                    onSelect={() => {
                      remember(f.id);
                      close();
                      runFunction(f.id).catch((e: Error) => toast(e.message, "error"));
                    }}
                  >
                    <span className="grow ellipsis">{functionTitle(f)}</span>
                    {enabled !== true && <span className="small muted">{enabled}</span>}
                    {f.shortcut && <kbd>{prettyShortcut(f.shortcut)}</kbd>}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
        <div className="palette-footer">
          <span className="row" style={{ gap: 6 }}>
            <IconCommand size={13} /> {t("shell.paletteHint", { n: registry.size })}
          </span>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd>
          </span>
        </div>
      </Command>
    </div>
  );
}
